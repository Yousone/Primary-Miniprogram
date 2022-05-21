module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046642263, function(require, module, exports) {
const Minipass = require('minipass')

class SizeError extends Error {
  constructor (found, expect) {
    super(`Bad data size: expected ${expect} bytes, but got ${found}`)
    this.expect = expect
    this.found = found
    this.code = 'EBADSIZE'
	  Error.captureStackTrace(this, this.constructor)
  }
  get name () {
    return 'SizeError'
  }
}

class MinipassSized extends Minipass {
  constructor (options = {}) {
    super(options)

    if (options.objectMode)
      throw new TypeError(`${
        this.constructor.name
      } streams only work with string and buffer data`)

    this.found = 0
    this.expect = options.size
    if (typeof this.expect !== 'number' ||
        this.expect > Number.MAX_SAFE_INTEGER ||
        isNaN(this.expect) ||
        this.expect < 0 ||
        !isFinite(this.expect) ||
        this.expect !== Math.floor(this.expect))
      throw new Error('invalid expected size: ' + this.expect)
  }

  write (chunk, encoding, cb) {
    const buffer = Buffer.isBuffer(chunk) ? chunk
      : typeof chunk === 'string' ?
        Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8')
      : chunk

    if (!Buffer.isBuffer(buffer)) {
      this.emit('error', new TypeError(`${
        this.constructor.name
      } streams only work with string and buffer data`))
      return false
    }

    this.found += buffer.length
    if (this.found > this.expect)
      this.emit('error', new SizeError(this.found, this.expect))

    return super.write(chunk, encoding, cb)
  }

  emit (ev, ...data) {
    if (ev === 'end') {
      if (this.found !== this.expect)
        this.emit('error', new SizeError(this.found, this.expect))
    }
    return super.emit(ev, ...data)
  }
}

MinipassSized.SizeError = SizeError

module.exports = MinipassSized

}, function(modId) {var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046642263);
})()
//miniprogram-npm-outsideDeps=["minipass"]
//# sourceMappingURL=index.js.map