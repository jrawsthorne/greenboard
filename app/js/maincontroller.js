angular.module('app.main', [])
    .controller("NavCtrl", ['$scope', '$state', '$stateParams', 'Data', 'target', 'targetVersions', 'version',
        function($scope, $state, $stateParams, Data, target, targetVersions, version){

            targetVersions = _.compact(targetVersions)
            Data.setTarget(target)
            Data.setSelectedVersion(version)
            Data.setTargetVersions(targetVersions)

            // activate build state
            $state.go("target.version.builds.build")

            // update target versions when drop down target changes
            $scope.changeTarget = function(target){
                $state.go("target.version", {target: target, version: "latest"})
            }

            // update target versions when drop down target changes
            $scope.changeVersion = function(newVersion){
                if(newVersion != version){
                    console.log(version)
                    Data.setBuildsFilter(10)
                    Data.setBuildFilter(2000)
                    $state.go("target.version", {version: newVersion})
                }
            }

        }])
    .controller('TimelineCtrl', ['$scope', '$state', 'versionBuilds', 'Data',
        function($scope, $state, versionBuilds, Data){
            $scope.versionBuilds = versionBuilds
            console.log("TIMEclien CTRL")
            
            // on build change reload jobs view
            $scope.onBuildChange = function(build){
                console.log("BUILD CHANGE")
                console.log(build)
                $scope.build = build
                Data.setBuild(build)
                if(build.indexOf("-") != -1){ build = build.split("-")[1]}
                $state.go("target.version.builds.build", {build: build})
            }

            // when build changes update timeline title
            $scope.$watch(function(){ return Data.getBuild()},
                function(build){
                    $scope.build = build
                })

            // activate generic build state
            $state.go("target.version.builds.build", {build: "latest"})
        }])


    .controller('JobsCtrl', ['$scope', '$state', '$stateParams', 'Data', 'buildJobs',
        function($scope, $state, $stateParams, Data, buildJobs){

            // order by name initially
            $scope.predicate = "result"
            $scope.reverse = true
            $scope.activePanel = 0

            

                $scope.onselect = 
                    function(jobname){
                        var activeJobs = Data.getActiveJobs()
                        // activeJobs = _.reject(activeJobs, "olderBuild", true)
                        activeJobs = _.reject(activeJobs, "deleted", true)
                        
                        var requiredJobs = _.filter(activeJobs,["name",jobname])
                            $scope.selectedjobdetails = requiredJobs
                            console.log(requiredJobs)
                            $scope.selectedjobname = jobname
                            $scope.selectedbuild = requiredJobs[0].build
                    }
                
            

            function updateScopeWithJobs(jobs){

                jobs = _.reject(jobs, "olderBuild", true)
                jobs = _.reject(jobs, "deleted", true)
                console.log("UPDATESCOPE")
                console.log(jobs)
                
                var jobsCompleted = _.uniq(_.reject(jobs, ["result", "PENDING"]))
                var jobsUnstable = _.uniq(_.filter(jobs, ["result", "UNSTABLE"]))
                var jobsFailed = _.uniq(_.filter(jobs, ["result", "FAILURE"]))
                var jobsPending = _.uniq(_.filter(jobs, ["result", "PENDING"]))
                

                $scope.panelTabs = [
                    {title: "Jobs Completed", jobs: jobsCompleted, active: true},
                    {title: "Jobs Unstable", jobs: jobsUnstable},
                    {title: "Jobs Failed", jobs: jobsFailed},
                    {title: "Jobs Pending", jobs: jobsPending}
                ]                
            }

            function getJobs() {
                var build = Data.getBuild()
                //var jobs = buildJobs[build].value
                //var allJobs = buildJobs['existing_builds'].value
                //var toReturn = processJob(jobs, allJobs)
                // console.log(buildJobs)
                return buildJobs
            }

            function processJob(jobs, allJobs) {
                var type = jobs.type
                var existingJobs
		        var version = Data.getSelectedVersion()
                if (type == "mobile"){
                    existingJobs = _.pick(allJobs, "mobile")
                }
                else {
                    existingJobs = _.omit(allJobs, "mobile")
                    existingJobs = _.merge(allJobs['server'], allJobs['build'])
                    fs = require('fs');
                    fs.writeFile("merge.json", existingJobs)
                }
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

            var jobs = getJobs()
            updateScopeWithJobs(jobs)
            Data.setBuildJobs(jobs)
            console.log("JOBS HEREEEEE")
            console.log(jobs)
            // set sidebar items from build job data
            var allPlatforms = _.uniq(_.map(jobs, "os"))
                .map(function(k){
                    return {key: k, disabled: false}
                })
            var allFeatures = _.uniq(_.map(jobs, "component"))
                .map(function(k){
                    return {key: k, disabled: false}
                })
            console.log(allPlatforms)
            Data.setSideBarItems({platforms: allPlatforms, features: allFeatures})



            $scope.changePanelJobs = function(i){
                $scope.activePanel = i
            }

            $scope.msToTime = msToTime
            // $scope.link = " "
            //         function isLink(job){
            //             console.log("ISLINK")
            //             if(job["single"]==false){
            //                 return "#!/jobdetails/"+job["name"]
            //                 $scope.link = "#!/jobdetails/"+job["name"]
            //             }
            //             return job["url"]+job["build_id"]
            //             $scope.link = " "
            //         }
            // $scope.isLink = isLink
            $scope.$watch(function(){ return Data.getActiveJobs() },
                function(activeJobs){
                    if(activeJobs){
                        updateScopeWithJobs(activeJobs)
                    }
                })


        }])
    .controller('JobDetailsCtrl',['$scope','$state','$stateParams','Data','target',
                function($scope,$state,$stateParams,Data,target){
                    console.log("HERE AT JOb DETAILS CONTROLLER")
                    // $scope.$watch(function(){
                    //     return jobDetails
                    // },function(jobDets){
                    //     $scope.jobDetails = jobDets
                    //     console.log(jobDets)
                    // })
                    
                    $scope.msToTime = msToTime
                    var jobname = $stateParams.jobName
                    
                    $scope.$watch(function(){
                        return Data.getActiveJobs()
                    },
                        function(activeJobs){
                            // activeJobs = _.reject(activeJobs, "olderBuild", true)
                            activeJobs = _.reject(activeJobs, "deleted", true)
                            
                            var requiredJobs = _.filter(activeJobs,["name",jobname])
                                $scope.jobDetails = requiredJobs
                                console.log(requiredJobs)
                           
                                $scope.jobname = jobname
                                $scope.build = requiredJobs[0].build
                        }
                    )
                    // console.log($stateParams.activeJobs)

    }])

    .directive('claimCell', ['Data', 'QueryService', function(Data, QueryService){
        return {
            restrict: 'E',
            scope: {job: "="},
            templateUrl: 'partials/claimcell.html',
            link: function(scope, elem, attrs){

                if(scope.job.customClaim){  // override claim
                    scope.job.claim = scope.job.customClaim
                }

                // publish on blur
                scope.editClaim = false
                scope.saveClaim = function(){
                    // publish
                    var target = Data.getCurrentTarget()
                    var name = scope.job.name
                    var build_id = scope.job.build_id
                    var claim = scope.job.claim
                    QueryService.claimJob(target, name, build_id, claim)
                        .catch(function(err){
                            scope.job.claim = "error saving claim: "+err.err
                        })
                    scope.editClaim = false

                }
            }
        }
    }])




// https://coderwall.com/p/wkdefg/converting-milliseconds-to-hh-mm-ss-mmm
function msToTime(duration) {
    var milliseconds = parseInt((duration%1000)/100)
        , seconds = parseInt((duration/1000)%60)
        , minutes = parseInt((duration/(1000*60))%60)
        , hours = parseInt((duration/(1000*60*60))%24);

    hours = (hours < 10) ? "0" + hours : hours;
    minutes = (minutes < 10) ? "0" + minutes : minutes;
    seconds = (seconds < 10) ? "0" + seconds : seconds;

    return hours + ":" + minutes + ":" + seconds;
}

