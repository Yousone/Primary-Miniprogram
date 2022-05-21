module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046641878, function(require, module, exports) {
const hasIntl = typeof Intl === 'object' && !!Intl
const Collator = hasIntl && Intl.Collator
const cache = new Map()

const collatorCompare = (locale, opts) => {
  const collator = new Collator(locale, opts)
  return (a, b) => collator.compare(a, b)
}

const localeCompare = (locale, opts) => (a, b) => a.localeCompare(b, locale, opts)

const knownOptions = [
  'sensitivity',
  'numeric',
  'ignorePunctuation',
  'caseFirst',
]

const { hasOwnProperty } = Object.prototype

module.exports = (locale, options = {}) => {
  if (!locale || typeof locale !== 'string')
    throw new TypeError('locale required')

  const opts = knownOptions.reduce((opts, k) => {
    if (hasOwnProperty.call(options, k)) {
      opts[k] = options[k]
    }
    return opts
  }, {})
  const key = `${locale}\n${JSON.stringify(opts)}`

  if (cache.has(key))
    return cache.get(key)

  const compare = hasIntl
    ? collatorCompare(locale, opts)
    : localeCompare(locale, opts)
  cache.set(key, compare)

  return compare
}

}, function(modId) {var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046641878);
})()
//miniprogram-npm-outsideDeps=[]
//# sourceMappingURL=index.js.map