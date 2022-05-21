module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046642312, function(require, module, exports) {
exports.email = email
exports.pw = pw
exports.username = username
var requirements = exports.requirements = {
  username: {
    length: 'Name length must be less than or equal to 214 characters long',
    lowerCase: 'Name must be lowercase',
    urlSafe: 'Name may not contain non-url-safe chars',
    dot: 'Name may not start with "."',
    illegal: 'Name may not contain illegal character'
  },
  password: {},
  email: {
    length: 'Email length must be less then or equal to 254 characters long',
    valid: 'Email must be an email address'
  }
}

var illegalCharacterRe = new RegExp('([' + [
  "'"
].join() + '])')

function username (un) {
  if (un !== un.toLowerCase()) {
    return new Error(requirements.username.lowerCase)
  }

  if (un !== encodeURIComponent(un)) {
    return new Error(requirements.username.urlSafe)
  }

  if (un.charAt(0) === '.') {
    return new Error(requirements.username.dot)
  }

  if (un.length > 214) {
    return new Error(requirements.username.length)
  }

  var illegal = un.match(illegalCharacterRe)
  if (illegal) {
    return new Error(requirements.username.illegal + ' "' + illegal[0] + '"')
  }

  return null
}

function email (em) {
  if (em.length > 254) {
    return new Error(requirements.email.length)
  }
  if (!em.match(/^[^@]+@.+\..+$/)) {
    return new Error(requirements.email.valid)
  }

  return null
}

function pw (pw) {
  return null
}

}, function(modId) {var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046642312);
})()
//miniprogram-npm-outsideDeps=[]
//# sourceMappingURL=index.js.map