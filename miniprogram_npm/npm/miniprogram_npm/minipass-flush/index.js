module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046642260, function(require, module, exports) {
const Minipass = require('minipass')
const _flush = Symbol('_flush')
const _flushed = Symbol('_flushed')
const _flushing = Symbol('_flushing')
class Flush extends Minipass {
  constructor (opt = {}) {
    if (typeof opt === 'function')
      opt = { flush: opt }

    super(opt)

    // or extend this class and provide a 'flush' method in your subclass
    if (typeof opt.flush !== 'function' && typeof this.flush !== 'function')
      throw new TypeError('must provide flush function in options')

    this[_flush] = opt.flush || this.flush
  }

  emit (ev, ...data) {
    if ((ev !== 'end' && ev !== 'finish') || this[_flushed])
      return super.emit(ev, ...data)

    if (this[_flushing])
      return

    this[_flushing] = true

    const afterFlush = er => {
      this[_flushed] = true
      er ? super.emit('error', er) : super.emit('end')
    }

    const ret = this[_flush](afterFlush)
    if (ret && ret.then)
      ret.then(() => afterFlush(), er => afterFlush(er))
  }
}

module.exports = Flush

}, function(modId) {var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046642260);
})()
//miniprogram-npm-outsideDeps=["minipass"]
//# sourceMappingURL=index.js.map