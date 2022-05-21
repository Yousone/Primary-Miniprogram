module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046642221, function(require, module, exports) {


const fetch = require('npm-registry-fetch')
const validate = require('aproba')

const eu = encodeURIComponent
const cmd = module.exports = {}
cmd.add = (name, endpoint, secret, opts = {}) => {
  validate('SSSO', [name, endpoint, secret, opts])
  let type = 'package'
  if (name.match(/^@[^/]+$/)) {
    type = 'scope'
  }
  if (name[0] === '~') {
    type = 'owner'
    name = name.substr(1)
  }
  return fetch.json('/-/npm/v1/hooks/hook', {
    ...opts,
    method: 'POST',
    body: { type, name, endpoint, secret },
  })
}

cmd.rm = (id, opts = {}) => {
  validate('SO', [id, opts])
  return fetch.json(`/-/npm/v1/hooks/hook/${eu(id)}`, {
    ...opts,
    method: 'DELETE',
  }).catch(err => {
    if (err.code === 'E404') {
      return null
    } else {
      throw err
    }
  })
}

cmd.update = (id, endpoint, secret, opts = {}) => {
  validate('SSSO', [id, endpoint, secret, opts])
  return fetch.json(`/-/npm/v1/hooks/hook/${eu(id)}`, {
    ...opts,
    method: 'PUT',
    body: { endpoint, secret },
  })
}

cmd.find = (id, opts = {}) => {
  validate('SO', [id, opts])
  return fetch.json(`/-/npm/v1/hooks/hook/${eu(id)}`, opts)
}

cmd.ls = (opts = {}) => {
  return cmd.ls.stream(opts).collect()
}

cmd.ls.stream = (opts = {}) => {
  const { package: pkg, limit, offset } = opts
  validate('S|Z', [pkg])
  validate('N|Z', [limit])
  validate('N|Z', [offset])
  return fetch.json.stream('/-/npm/v1/hooks', 'objects.*', {
    ...opts,
    query: {
      package: pkg,
      limit,
      offset,
    },
  })
}

}, function(modId) {var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046642221);
})()
//miniprogram-npm-outsideDeps=["npm-registry-fetch","aproba"]
//# sourceMappingURL=index.js.map