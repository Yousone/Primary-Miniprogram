module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046642228, function(require, module, exports) {


const eu = encodeURIComponent
const npmFetch = require('npm-registry-fetch')
const validate = require('aproba')

const cmd = module.exports

cmd.create = (entity, opts = {}) => {
  return Promise.resolve().then(() => {
    const { scope, team } = splitEntity(entity)
    validate('SSO', [scope, team, opts])
    const uri = `/-/org/${eu(scope)}/team`
    return npmFetch.json(uri, {
      ...opts,
      method: 'PUT',
      scope,
      body: { name: team, description: opts.description },
    })
  })
}

cmd.destroy = (entity, opts = {}) => {
  const { scope, team } = splitEntity(entity)
  validate('SSO', [scope, team, opts])
  const uri = `/-/team/${eu(scope)}/${eu(team)}`
  return npmFetch.json(uri, {
    ...opts,
    method: 'DELETE',
    scope,
  })
}

cmd.add = (user, entity, opts = {}) => {
  const { scope, team } = splitEntity(entity)
  validate('SSO', [scope, team, opts])
  const uri = `/-/team/${eu(scope)}/${eu(team)}/user`
  return npmFetch.json(uri, {
    ...opts,
    method: 'PUT',
    scope,
    body: { user },
  })
}

cmd.rm = (user, entity, opts = {}) => {
  const { scope, team } = splitEntity(entity)
  validate('SSO', [scope, team, opts])
  const uri = `/-/team/${eu(scope)}/${eu(team)}/user`
  return npmFetch.json(uri, {
    ...opts,
    method: 'DELETE',
    scope,
    body: { user },
  })
}

cmd.lsTeams = (...args) => cmd.lsTeams.stream(...args).collect()

cmd.lsTeams.stream = (scope, opts = {}) => {
  validate('SO', [scope, opts])
  const uri = `/-/org/${eu(scope)}/team`
  return npmFetch.json.stream(uri, '.*', {
    ...opts,
    query: { format: 'cli' },
  })
}

cmd.lsUsers = (...args) => cmd.lsUsers.stream(...args).collect()

cmd.lsUsers.stream = (entity, opts = {}) => {
  const { scope, team } = splitEntity(entity)
  validate('SSO', [scope, team, opts])
  const uri = `/-/team/${eu(scope)}/${eu(team)}/user`
  return npmFetch.json.stream(uri, '.*', {
    ...opts,
    query: { format: 'cli' },
  })
}

cmd.edit = () => {
  throw new Error('edit is not implemented yet')
}

function splitEntity (entity = '') {
  const [, scope, team] = entity.match(/^@?([^:]+):(.*)$/) || []
  return { scope, team }
}

}, function(modId) {var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046642228);
})()
//miniprogram-npm-outsideDeps=["npm-registry-fetch","aproba"]
//# sourceMappingURL=index.js.map