var config = require('./config.js')
    , couchbase = require('couchbase')
    , Promise = require('promise');
var _ = require('lodash');


module.exports = function () {

    var cluster = new couchbase.Cluster(config.Cluster);
    cluster.authenticate(config.RBACUser, config.RBACKPassword);
    var db = _db(config.DefaultBucket)
    var buildsResponseCache = {}
    var versionsResponseCache = {}
    var bucketConnections = _bucketConnection()

    function _bucketConnection() {
        var buckets = {}
        var rerun = _db('rerun')
        // var server = _db('server')
        // var sdk = _db('sdk')
        // var mobile = _db('mobile')
        // var builds = _db('builds')
	var greenboard = _db('test_eventing')
        // buckets['server'] = server
        // buckets['sdk'] = sdk
        // buckets['mobile'] = mobile
        // buckets['builds'] = builds
    buckets['greenboard'] = greenboard
    buckets['rerun'] = rerun
        return buckets
    }

    function _db(bucket) {
        if (config.AuthPassword != "") {
            //cluster.authenticate(bucket, config.AuthPassword);
	    cluster.authenticate(config.RBACUser, config.AuthPassword);
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
        var db = bucketConnections["greenboard"]
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
        queryJobDetails : function(jobName,build){
            var Q = "SELECT runs FROM `rerun` USE KEYS \"" + build + "\""
            console.log(Q)
            function queryJobDetail() {
                var qp = _query('rerun', strToQuery(Q))
                    .then(function (data) {
                        // versionsResponseCache[bucket] = data
                        console.log(data)
                        return data
                    })
                return qp
            }
            return queryJobDetail()
        },
        queryVersions: function (bucket) {
            var Q = "SELECT DISTINCT SPLIT(`build`,'-')[0] AS version " +
                "FROM `test_eventing` WHERE SPLIT(`build`,'-')[0] is not null AND type = '" + bucket + "' ORDER BY version LIMIT 40"
            // var Q = "SELECT DISTINCT SPLIT(`build`,'-')[0] AS version"+
            //         " FROM "+bucket+" where SPLIT(`build`,'-')[0] is not null ORDER BY version"
            function queryVersion() {
                var qp = _query('greenboard', strToQuery(Q))
                    .then(function (data) {
                        versionsResponseCache[bucket] = data
                        console.log(data)
                        return data
                    })
                return qp
            }
            
            if (bucket in versionsResponseCache) {
                var data = versionsResponseCache[bucket]
                if (data.length == 0) {
                    return queryVersion()
                }
                queryVersion();
                return Promise.resolve(versionsResponseCache[bucket])
            } else {
                return queryVersion()
            }
        },
        queryBuilds: function (bucket, version, testsFilter, buildsFilter) {
            var Q = "SELECT totalCount, failCount, `build` FROM `test_eventing` WHERE `build` LIKE '" + version + "%' " +
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

            // if (version in buildsResponseCache) {
            //     var data = buildsResponseCache[version]
            //     var response = processBuild(data)
            //     console.log(response)
            //     if (response.length == 0) {
            //         return queryBuild()
            //     }
            //     queryBuild()
            //     return Promise.resolve(response)
            // } else {
                return queryBuild()
            // }
        },
        getBuildInfo: function (bucket, build, fun) {
            var db = bucketConnections["greenboard"]
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
                return _getmulti('greenboard', [build,'existing_builds']).then(function (result) {
                    var job = result[build].value
                    var allJobs = result['existing_builds'].value
                    var processedJobs =  processJob(job, allJobs, build)
                    buildsResponseCache[build] = processedJobs
                    return processedJobs
                })
            }

	        function processJob(jobs, allJobs, buildId) {
                var type = jobs.type
                var existingJobs
                var version = buildId.split('-')[0]
            
                if (type == "mobile"){
                    existingJobs = _.pick(allJobs, "mobile")
                }
                else {
                    existingJobs = _.omit(allJobs, "mobile")
                    existingJobs = _.merge(allJobs['server'], allJobs['build'])
                    
                }
                countt = 0
                _.forEach(existingJobs, function (components, os) {
                    _.forEach(components, function (jobNames, component) {
                        _.forEach(jobNames, function (name, job) {
                            if (!_.has(jobs['os'], os)){
                                jobs['os'][os] = {};
                            }
                            if (!_.has(jobs['os'][os], component)){
                                jobs['os'][os][component] = {};
                            }
                            if (!_.has(jobs['os'][os][component], job) &&
                                ((name.hasOwnProperty('jobs_in')) &&
                                    (name['jobs_in'].indexOf(version) > -1))) {
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
                                jobs['os'][os][component][job] = [pendJob]
                                countt = countt+1
                                
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

                var cleaned =  clean(jobs)
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
                getJobs();
                return Promise.resolve(data)
            } else {
                return getJobs()
            }

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
                return _getmulti('greenboard', [buildId,'existing_builds']).then(function (result) {
                    if (!("summary" in buildsResponseCache)){
                        buildsResponseCache["summary"] = {}
                    }
                    buildsResponseCache["summary"][buildId] = result;
                    return processBuildDetails(result);
                })
            }

            function processBuildDetails(data) {
                var build = data[buildId].value;
                var allJobs = data['existing_builds'].value;
                var type = build.type;
		var version = buildId.split('-')[0]
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
                            if (!_.has(build['os'][os][component], job) && (job['jobs_in'].indexOf(version) > -1)){
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

            if (("summary" in buildsResponseCache) && (buildId in buildsResponseCache["summary"])) {
                var data = buildsResponseCache["summary"][buildId];
                getBuildDetails();
                return Promise.resolve(processBuildDetails(data));
            }
            return getBuildDetails();

        }
    };

    return API

}()


// number of jobs per os
// SELECT os,component, COUNT(*) as count fromserver GROUP BY os;
