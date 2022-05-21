module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046642051, function(require, module, exports) {


const ipRegex = require("ip-regex");

const defaultOpts = {exact: false};

const v4str = `${ipRegex.v4().source}\\/(3[0-2]|[12]?[0-9])`;
const v6str = `${ipRegex.v6().source}\\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])`;

// can not precompile the non-exact regexes because global flag makes the regex object stateful
// which would require the user to reset .lastIndex on subsequent calls
const v4exact = new RegExp(`^${v4str}$`);
const v6exact = new RegExp(`^${v6str}$`);
const v46exact = new RegExp(`(?:^${v4str}$)|(?:^${v6str}$)`);

module.exports = ({exact} = defaultOpts) => exact ? v46exact : new RegExp(`(?:${v4str})|(?:${v6str})`, "g");
module.exports.v4 = ({exact} = defaultOpts) => exact ? v4exact : new RegExp(v4str, "g");
module.exports.v6 = ({exact} = defaultOpts) => exact ? v6exact : new RegExp(v6str, "g");

}, function(modId) {var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046642051);
})()
//miniprogram-npm-outsideDeps=["ip-regex"]
//# sourceMappingURL=index.js.map