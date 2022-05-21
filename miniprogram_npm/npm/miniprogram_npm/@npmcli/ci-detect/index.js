module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046641921, function(require, module, exports) {
module.exports = () =>
  process.env.GERRIT_PROJECT ? 'gerrit'
  : process.env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI ? 'azure-pipelines'
  : process.env.BITRISE_IO ? 'bitrise'
  : process.env.BUDDY_WORKSPACE_ID ? 'buddy'
  : process.env.BUILDKITE ? 'buildkite'
  : process.env.CIRRUS_CI ? 'cirrus'
  : process.env.GITLAB_CI ? 'gitlab'
  : process.env.APPVEYOR ? 'appveyor'
  : process.env.CIRCLECI ? 'circle-ci'
  : process.env.SEMAPHORE ? 'semaphore'
  : process.env.DRONE ? 'drone'
  : process.env.DSARI ? 'dsari'
  : process.env.GITHUB_ACTION ? 'github-actions'
  : process.env.TDDIUM ? 'tddium'
  : process.env.SCREWDRIVER ? 'screwdriver'
  : process.env.STRIDER ? 'strider'
  : process.env.TASKCLUSTER_ROOT_URL ? 'taskcluster'
  : process.env.JENKINS_URL ? 'jenkins'
  : process.env['bamboo.buildKey'] ? 'bamboo'
  : process.env.GO_PIPELINE_NAME ? 'gocd'
  : process.env.HUDSON_URL ? 'hudson'
  : process.env.WERCKER ? 'wercker'
  : process.env.NETLIFY ? 'netlify'
  : process.env.NOW_GITHUB_DEPLOYMENT ? 'now-github'
  : process.env.GITLAB_DEPLOYMENT ? 'now-gitlab'
  : process.env.BITBUCKET_DEPLOYMENT ? 'now-bitbucket'
  : process.env.BITBUCKET_BUILD_NUMBER ? 'bitbucket-pipelines'
  : process.env.NOW_BUILDER ? 'now'
  : process.env.VERCEL_GITHUB_DEPLOYMENT ? 'vercel-github'
  : process.env.VERCEL_GITLAB_DEPLOYMENT ? 'vercel-gitlab'
  : process.env.VERCEL_BITBUCKET_DEPLOYMENT ? 'vercel-bitbucket'
  : process.env.VERCEL_URL ? 'vercel'
  : process.env.MAGNUM ? 'magnum'
  : process.env.NEVERCODE ? 'nevercode'
  : process.env.RENDER ? 'render'
  : process.env.SAIL_CI ? 'sail'
  : process.env.SHIPPABLE ? 'shippable'
  : process.env.TEAMCITY_VERSION ? 'teamcity'
  // codeship and a few others
  : process.env.CI_NAME ? process.env.CI_NAME
  // heroku doesn't set envs other than node in a heroku-specific location
  : /\/\.heroku\/node\/bin\/node$/.test(process.env.NODE || '') ? 'heroku'
  // test travis after the others, since several CI systems mimic it
  : process.env.TRAVIS ? 'travis-ci'
  // aws CodeBuild/CodePipeline
  : process.env.CODEBUILD_SRC_DIR ? 'aws-codebuild'
  : process.env.CI === 'true' || process.env.CI === '1' ? 'custom'
  // Google Cloud Build - it sets almost nothing
  : process.env.BUILDER_OUTPUT ? 'builder'
  : false

}, function(modId) {var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046641921);
})()
//miniprogram-npm-outsideDeps=[]
//# sourceMappingURL=index.js.map