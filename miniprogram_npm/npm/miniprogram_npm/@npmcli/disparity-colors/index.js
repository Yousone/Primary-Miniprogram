module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046641930, function(require, module, exports) {
const ansi = require('ansi-styles')

const colors = {
  removed: ansi.red,
  added: ansi.green,
  header: ansi.yellow,
  section: ansi.magenta
}

function colorize (str, opts) {
  let headerLength = (opts || {}).headerLength
  if (typeof headerLength !== 'number' || Number.isNaN(headerLength)) {
    headerLength = 2
  }

  const color = (str, colorId) => {
    const { open, close } = colors[colorId]
    // avoid highlighting the "\n" (would highlight till the end of the line)
    return str.replace(/[^\n\r]+/g, open + '$&' + close)
  }

  // this RegExp will include all the `\n` chars into the lines, easier to join
  const lines = ((typeof str === 'string' && str) || '').split(/^/m)

  const start = color(lines.slice(0, headerLength).join(''), 'header')
  const end = lines.slice(headerLength).join('')
    .replace(/^-.*/gm, color('$&', 'removed'))
    .replace(/^\+.*/gm, color('$&', 'added'))
    .replace(/^@@.+@@/gm, color('$&', 'section'))

  return start + end
}

module.exports = colorize

}, function(modId) {var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046641930);
})()
//miniprogram-npm-outsideDeps=["ansi-styles"]
//# sourceMappingURL=index.js.map