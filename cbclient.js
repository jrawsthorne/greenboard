var config = require('./config.js')
    , couchbase = require('couchbase')
    , Promise = require('promise');
var _ = require('lodash');


module.exports = function () {

    var cluster = new couchbase.Cluster(config.Cluster);
    var db = _db(config.DefaultBucket)
    var buildsResponseCache = {}
    var versionsResponseCache = {}
    var bucketConnections = _bucketConnection()

    function _bucketConnection() {
        var buckets = {}
        var server = _db('server')
        var sdk = _db('sdk')
        var mobile = _db('mobile')
        var builds = _db('builds')
        buckets['server'] = server
        buckets['sdk'] = sdk
        buckets['mobile'] = mobile
        buckets['builds'] = builds
        return buckets
    }

    function _db(bucket) {
        if (config.AuthPassword != "") {
            cluster.authenticate(bucket, config.AuthPassword);
        }
        var db = cluster.openBucket(bucket)
        db.operationTimeout = 120 * 1000
        return db
    }

    function strToQuery(queryStr, adhoc) {
        console.log(new Date(), "QUERY:", queryStr)
        adhoc = adhoc ? true : false
        return couchbase.N1qlQuery.fromString(queryStr).adhoc(adhoc)
    }

    function _query(bucket, q) {
        var db = bucketConnections[bucket]
        if (!db.connected) {
            db = _db(bucket);
            bucketConnections[bucket] = db
        }
        var promise = new Promise(function (resolve, reject) {
            db.query(q, function (err, components) {
                if (!err) {
                    resolve(components)
                } else {
                    reject(err)
                }
            })
        })
        return promise
    }

    function _getmulti(bucket, docIds) {
        var db = bucketConnections[bucket]
        if (!db.connected){
            db = _db(bucket);
            bucketConnections[bucket] = db
        }
        return new Promise(function (resolve, reject) {
            db.getMulti(docIds, function (error, result) {
                if (error) {
                    reject(error)
                } else {
                    resolve(result)
                }
            })
        })
    }

    function _get(bucket, documentId) {
        var db = bucketConnections[bucket];
        if (!db.connected){
            db = _db(bucket);
            bucketConnections[bucket] = db
        }
        return new Promise(function (resolve, reject) {
            db.get(documentId, function (error, result) {
                if (error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            })
        });
    }

    function doUpsert(bucket, key, doc) {
        var db = bucketConnections[bucket]
        if (!db.connected){
            db = _db(bucket);
            bucketConnections[bucket] = db
        }
        var promise = new Promise(function (resolve, reject) {
            db.upsert(key, doc, function (err, result) {
                if (err) {
                    reject({err: err})
                }
                else {
                    resolve(result)
                }
            })
        })
        return promise
    }

    var API = {

        queryVersions: function (bucket) {
            var Q = "SELECT DISTINCT SPLIT(`build`,'-')[0] AS version " +
                "FROM builds WHERE SPLIT(`build`,'-')[0] is not null AND type = '" + bucket + "' ORDER BY version"
            // var Q = "SELECT DISTINCT SPLIT(`build`,'-')[0] AS version"+
            //         " FROM "+bucket+" where SPLIT(`build`,'-')[0] is not null ORDER BY version"
            function queryVersion() {
                var qp = _query('builds', strToQuery(Q))
                    .then(function (data) {
                        versionsResponseCache[bucket] = data
                        return data
                    })
                return qp
            }

            if (bucket in versionsResponseCache) {
                var data = versionsResponseCache[bucket]
                if (data.length == 0) {
                    return queryVersion()
                }
                return Promise.resolve(versionsResponseCache[bucket])
            } else {
                return queryVersion()
            }
        },
        queryBuilds: function (bucket, version, testsFilter, buildsFilter) {
            var Q = "SELECT totalCount, failCount, `build` FROM builds WHERE `build` LIKE '" + version + "%' " +
                " AND type = '" + bucket + "' AND totalCount >= " + testsFilter + " ORDER BY `build` DESC limit " + buildsFilter
            // var Q = "SELECT SUM(totalCount) AS totalCount, SUM(failCount) AS failCount, `build`  FROM "
            //     +bucket+" WHERE `build` LIKE '"+version+"%' GROUP BY `build` HAVING SUM(totalCount) >= " + testsFilter +
            //     " ORDER BY `build` DESC limit "+buildsFilter

            function processBuild(data) {

                var builds = _.map(data, function (buildSet) {
                    var total = buildSet.totalCount
                    var failed = buildSet.failCount
                    var passed = total - failed
                    return {
                        Failed: failed,
                        Passed: passed,
                        build: buildSet.build
                    }
                })
                return builds
            }

            function queryBuild() {
                var qp = _query(bucket, strToQuery(Q))
                    .then(function (data) {
                        buildsResponseCache[version] = _.cloneDeep(data)
                        return processBuild(data)
                    })
                return qp
            }

            if (version in buildsResponseCache) {
                var data = buildsResponseCache[version]
                var response = processBuild(data)
                if (response.length == 0) {
                    return queryBuild()
                }
                return Promise.resolve(response)
            } else {
                return queryBuild()
            }
        },
        getBuildInfo: function (bucket, build, fun) {
            var db = bucketConnections[bucket]
            if (!db.connected){
                db = _db(bucket);
                bucketConnections[bucket] = db
            }
            db.get(build, fun)
        },
        jobsForBuild: function (bucket, build) {
            var ver = build.split('-')[0]
            var Q = "SELECT * FROM " + bucket + " WHERE `build` = '" + build + "'"

            function getJobs() {
                return _getmulti('builds', [build,'existing_builds']).then(function (result) {
                    //var job = result[build].value
                    //var allJobs = result['existing_builds'].value
                    //var processedJobs =  processJob(job, allJobs)
                    buildsResponseCache[build] = result
                    return result
                })
            }

            function processJob(build, allJobs) {
                var type = build.type
                var existingJobs
                if (type == "mobile"){
                    existingJobs = _.pick(allJobs, "mobile")
                }
                else {
                    existingJobs = _.omit(allJobs, "mobile")
                    existingJobs = _.merge(allJobs['server'], allJobs['build'])
                }
                _.forEach(existingJobs, function (components, os) {
                    _.forEach(components, function (jobNames, component) {
                        _.forEach(jobNames, function (name, job) {
                            if (!_.has(build['os'][os][component], job)){
                                var pendJob = {}
                                pendJob['pending'] = name.totalCount
                                pendJob['totalCount'] = 0
                                pendJob['failCount'] = 0
                                pendJob['result'] = "PENDING"
                                pendJob['priority'] = name.priority
                                pendJob['url'] = name.url
                                pendJob['build_id'] = ""
                                pendJob['claim'] = ""
                                pendJob['deleted'] = false
                                pendJob['olderBuild'] = false
                                pendJob['duration'] = 0
                                pendJob['color'] = ''
                                build['os'][os][component][job] = [pendJob]
                            }
                        })
                    })
                })

                function clean(el) {
                    function internalClean(el) {
                        return _.transform(el, function(result, value, key) {
                            var isCollection = _.isObject(value);
                            var cleaned = isCollection ? internalClean(value) : value;

                            if (isCollection && _.isEmpty(cleaned)) {
                                return;
                            }

                            _.isArray(result) ? result.push(cleaned) : (result[key] = cleaned);
                        });
                    }

                    return _.isObject(el) ? internalClean(el) : el;
                }
                var cleaned =  clean(build)
                var toReturn = new Array()

                _.forEach(cleaned.os, function (components, os) {
                    _.forEach(components, function (jobNames, component) {
                        _.forEach(jobNames, function (jobs, jobName) {
                            _.forEach(jobs, function (jobDetail, job) {
                                var tempJob = _.cloneDeep(jobDetail)
                                tempJob['build'] = cleaned.build
                                tempJob['name'] = jobName
                                tempJob['component'] = component
                                tempJob['os'] = os
                                toReturn[toReturn.length] = tempJob
                            })
                        })
                    })
                })
                
                return toReturn
            }

            if (build in buildsResponseCache){
                var data = buildsResponseCache[build]
                return Promise.resolve(data)
            } else {
                return getJobs()
            }

/*            function processJobs(queryData, pendingJobs) {

                // jobs for this build
                var data = _.map(queryData, bucket)
                var jobs = _.filter(data, 'build', build)
                var jobNames = _.map(jobs, 'name')

                /!*var pending = _.filter(data, function(j){
                  // job is pending if name is not in known job names
                  return _.indexOf(jobNames, j.name) == -1
                })*!/

                // convert total to pending for non-executed jobs
                var pending = _.map(_.uniq(_.map(pendingJobs, bucket), 'name'), function (job) {
                    job["pending"] = job.totalCount || job.pending
                    job["totalCount"] = 0
                    job["failCount"] = 0
                    job["result"] = "PENDING"
                    return job
                })
                return jobs.concat(pending)
            }

            // run query
            function queryJob() {
                return _query(bucket, strToQuery(Q)).then(function (data) {
                    var pend = "select * from " + bucket + " where `build` like '" + ver + "%' " +
                        "and name not in (select raw name from " + bucket + " b where b.`build` = '" + build + "') " +
                        "order by `build` desc"
                    if (ver + "pendingJobs" in buildsResponseCache && buildsResponseCache[ver + "pendingJobs"].length != 0) {
                        var pending = buildsResponseCache[ver + "pendingJobs"]
                        var jobs = processJobs(data, pending)
                    } else {
                        var jobs = _query(bucket, strToQuery(pend)).then(function (pending) {
                            buildsResponseCache[build + "data"] = _.cloneDeep(data)
                            buildsResponseCache[ver + "pendingJobs"] = _.cloneDeep(pending)
                            return processJobs(data, pending)
                        })
                    }
                    return jobs
                })
            }

            if (build + "data" in buildsResponseCache) {
                var data = buildsResponseCache[build + "data"]
                var pendingjobs = buildsResponseCache[ver + "pendingJobs"]
                if (data.length == 0 || pendingjobs.length == 0) {
                    return queryJob()
                }
                var response = processJobs(data, pendingjobs)
                return Promise.resolve(response)
            } else {
                return queryJob()
            }*/

        },
        claimJobs: function (bucket, name, build_id, claim) {

            // claim this build an all newer builds
            var Q = "SELECT meta(" + bucket + ").id,* FROM " + bucket + " WHERE name='" + name + "' AND build_id >= " + build_id
            var _ps = []
            var promise = new Promise(function (resolve, reject) {
                _query(bucket, strToQuery(Q)).catch(reject)
                    .then(function (jobs) {
                        jobs.forEach(function (d) {
                            var key = d.id
                            var doc = d.server
                            doc.customClaim = claim  // save new claim tag
                            var p = doUpsert(bucket, key, doc)
                            _ps.push(p)
                        })
                        Promise.all(_ps) // resolve upsert promises
                            .then(resolve).catch(reject)
                    })
            })
            return promise
        },
        getBuildSummary: function (buildId) {
            function getBuildDetails() {
                return _getmulti('builds', [buildId,'existing_builds']).then(function (result) {
                    //buildsResponseCache[buildId] = result;
                    return processBuildDetails(result);
                })
            }

            function processBuildDetails(data) {
                var build = data[buildId].value;
                var allJobs = data['existing_builds'].value;
                var type = build.type;
                var existingJobs;
                if (type == "mobile"){
                    existingJobs = _.pick(allJobs, "mobile");
                }
                else {
                    existingJobs = _.omit(allJobs, "mobile");
                    existingJobs = _.merge(allJobs['server'], allJobs['build']);
                }
                _.forEach(existingJobs, function (components, os) {
                    _.forEach(components, function (jobNames, component) {
                        _.forEach(jobNames, function (name, job) {
                            if (!_.has(build['os'], os)){
                                build['os'][os] = {};
                            }
                            if (!_.has(build['os'][os], component)){
                                build['os'][os][component] = {};
                            }
                            if (!_.has(build['os'][os][component], job)){
                                var pendJob = {};
                                pendJob['pending'] = name.totalCount;
                                pendJob['totalCount'] = 0;
                                pendJob['failCount'] = 0;
                                pendJob['result'] = "PENDING";
                                pendJob['priority'] = name.priority;
                                pendJob['url'] = name.url;
                                pendJob['build_id'] = "";
                                pendJob['claim'] = "";
                                pendJob['deleted'] = false;
                                pendJob['olderBuild'] = false;
                                pendJob['disabled'] = false;
                                pendJob['duration'] = 0;
                                pendJob['color'] = '';
                                build['os'][os][component][job] = [pendJob];
                            }
                        })
                    })
                });

                function clean(el) {
                    function internalClean(el) {
                        return _.transform(el, function(result, value, key) {
                            var isCollection = _.isObject(value);
                            var cleaned = isCollection ? internalClean(value) : value;

                            if (isCollection && _.isEmpty(cleaned)) {
                                return;
                            }

                            _.isArray(result) ? result.push(cleaned) : (result[key] = cleaned);
                        });
                    }

                    return _.isObject(el) ? internalClean(el) : el;
                }

                var cleaned =  clean(build);

                var sumTotalCount = function (total, job) {
                    var totalCount = _.reduce(job, function (total, _job) {
                        if (_job.olderBuild || _job.disabled){
                            return total + 0;
                        }
                        return total + _job.totalCount;
                    }, 0);
                    return total + totalCount;
                };
                var sumFailCount = function (total, job) {
                    var failCount = _.reduce(job, function (total, _job) {
                        if (_job.olderBuild || _job.disabled){
                            return total + 0;
                        }
                        return total + _job.failCount;
                    }, 0);
                    return total + failCount;
                };
                var sumPendingCount = function (total, job) {
                    var pendingCount = _.reduce(job, function (total, _job) {
                        if (_job.olderBuild || _job.disabled){
                            return total + 0;
                        }
                        return total + (_job.pending || 0);
                    }, 0);
                    return total + pendingCount;
                };
                var  transformComponent = function (component) {
                    return {
                        totalCount: _.reduce(component, sumTotalCount, 0),
                        failCount: _.reduce(component, sumFailCount, 0),
                        pending: _.reduce(component, sumPendingCount, 0)
                    };
                };
                var transformOs = function (os) {
                    var transformedComponents = _.mapValues(os, transformComponent);
                    var totalCount = _.reduce(transformedComponents, function (total, component) {
                        return total + component.totalCount;
                    }, 0);
                    var failCount = _.reduce(transformedComponents, function (total, component) {
                        return total + component.failCount;
                    }, 0);
                    var pendingCount = _.reduce(transformedComponents, function (total, component) {
                        return total + component.pending;
                    }, 0);
                    transformedComponents['totalCount'] = totalCount;
                    transformedComponents['failCount'] = failCount;
                    transformedComponents['pending'] = pendingCount;
                    return transformedComponents;
                };

                cleaned.os = _.mapValues(cleaned.os, transformOs);

                return cleaned
            }

            var buildDetails = getBuildDetails();
            return buildDetails;
        }
    };

    return API

}()


// number of jobs per os
// SELECT os,component, COUNT(*) as count from server GROUP BY os;
