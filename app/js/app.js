'usev strict'

var app = angular.module('greenBoard', [
  'plotly',
  'ui.router',
  'svc.data',
  'svc.query',
  'app.main',
  'app.target',
]);

app.config(['$stateProvider', '$urlRouterProvider',
  function($stateProvider, $urlRouterProvider){

    // TODO: external bootstrap with now testing build!
    $urlRouterProvider.otherwise("/server/4.1.0/latest");

    $stateProvider
      .state('target', {
        url: "/:target",
        abstract: true,
        template: '<ui-view/>',
        resolve: {
          target: ['$stateParams', function($stateParams){
              return $stateParams.target
            }],
          targetVersions: ['$stateParams', 'Data', 'QueryService',
            function($stateParams, Data, QueryService){

              var target = $stateParams.target
              var versions = Data.getTargetVersions(target)
              if(!versions){
                // get versions for Target
                versions = QueryService.getVersions(target)
              }
              return versions
          }]
        }
      })
      .state('target.version', {
        url: "/:version/:build",
        templateUrl: "view.html",
        controller: "NavCtrl",
        resolve: {
          version: ['$stateParams', '$location', 'targetVersions', 'target',
            function($stateParams, $location, targetVersions, target){

              var version = $stateParams.version
              if ((version == "latest") || targetVersions.indexOf(version) == -1){
                // uri is either latest version or some unknown version of target
                // just use latested known version of target
                version = targetVersions[targetVersions.length-1]
                $location.path(target+"/"+version)
              }
              return version
            }],
            build: ['$stateParams', function($stateParams){
              return $stateParams.build
            }]
        }
      })
      .state('target.version.build', {
        templateUrl: "partials/builds.html",
        controller: "BuildCtrl",
        resolve: {
          versionBuilds: ['QueryService', 'target', 'version',
            function(QueryService, target, version){
                return QueryService.getBuilds(target, version)
            }]
        }
      })

  }]);
