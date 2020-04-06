angular.module('svc.query', [])
	.service("QueryService",['$http', 'Data',
		function($http, Data){
		  return {
			getVersions: function(target){
				var url = ["versions", target].join("/")
		        return $http({"url": url, cache: true})
		        			.then(function(response){
		        				return response.data
		        			})
			},
			getBuilds: function(target, version, testsFilter, buildsFilter){
				console.log("getbuilds"+buildsFilter)
				var url = ["builds", target, version, testsFilter, buildsFilter].join("/")
				
		        return $http({"url": url, cache: true})
		        			.then(function(response){
								console.log(response.data)
								
		        				return response.data
		        			})				
			},
			getJobs: function(build, target){
				var url = ["jobs", build, target].join("/")
		        return $http({"url": url, cache: true})
		        			.then(function(response){
		        				return response.data
		        			})				
			},
			getBuildInfo: function(build, target){
				var url = ["info", build, target].join("/")
				return $http({"url": url, cache: true})
                           .then(function(response){
                               return response.data
                        })
			},
			claimJob: function(target, name, build_id, claim){
				var url = ["claim", target, name, build_id].join("/")
				return $http.post(url, {claim: claim})
			},
			getBuildSummary: function (buildId) {
				var url = ["getBuildSummary", buildId].join("/")
				return $http({"url": url, cache: true})
					.then(function (response) {
						return response.data
                    })
			},
			getJobDetails : function (jobName,build){
				var url = ["getJobDetails",jobName,build].join("/")
				console.log(url)
				return $http({"url":url,cache:true})
				.then(function(response){
					console.log(response.data)
					return response.data
				})
			}
		  }
		}])
