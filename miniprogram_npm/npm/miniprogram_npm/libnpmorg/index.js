module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046642222, function(require, module, exports) {


const eu = encodeURIComponent
const fetch = require('npm-registry-fetch')
const validate = require('aproba')

// From https://github.com/npm/registry/blob/master/docs/orgs/memberships.md
const cmd = module.exports

class MembershipDetail {}
cmd.set = (org, user, role, opts = {}) => {
  if (
    typeof role === 'object' &&
    Object.keys(opts).length === 0
  ) {
    opts = role
    role = undefined
  }
  validate('SSSO|SSZO', [org, user, role, opts])
  user = user.replace(/^@?/, '')
  org = org.replace(/^@?/, '')
  return fetch.json(`/-/org/${eu(org)}/user`, {
    ...opts,
    method: 'PUT',
    body: { user, role },
  }).then(ret => Object.assign(new MembershipDetail(), ret))
}

cmd.rm = (org, user, opts = {}) => {
  validate('SSO', [org, user, opts])
  user = user.replace(/^@?/, '')
  org = org.replace(/^@?/, '')
  return fetch(`/-/org/${eu(org)}/user`, {
    ...opts,
    method: 'DELETE',
    body: { user },
    ignoreBody: true,
  }).then(() => null)
}

class Roster {}
cmd.ls = (org, opts = {}) => {
  return cmd.ls.stream(org, opts)
    .collect()
    .then(data => data.reduce((acc, [key, val]) => {
      if (!acc) {
        acc = {}
      }
      acc[key] = val
      return acc
    }, null))
    .then(ret => Object.assign(new Roster(), ret))
}

cmd.ls.stream = (org, opts = {}) => {
  validate('SO', [org, opts])
  org = org.replace(/^@?/, '')
  return fetch.json.stream(`/-/org/${eu(org)}/user`, '*', {
    ...opts,
    mapJSON: (value, [key]) => {
      return [key, value]
    },
  })
}

}, function(modId) {var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046642222);
})()
//miniprogram-npm-outsideDeps=["npm-registry-fetch","aproba"]
//# sourceMappingURL=index.js.map