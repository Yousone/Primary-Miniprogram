module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046642262, function(require, module, exports) {
const Minipass = require('minipass')
const EE = require('events')
const isStream = s => s && s instanceof EE && (
  typeof s.pipe === 'function' || // readable
  (typeof s.write === 'function' && typeof s.end === 'function') // writable
)

const _head = Symbol('_head')
const _tail = Symbol('_tail')
const _linkStreams = Symbol('_linkStreams')
const _setHead = Symbol('_setHead')
const _setTail = Symbol('_setTail')
const _onError = Symbol('_onError')
const _onData = Symbol('_onData')
const _onEnd = Symbol('_onEnd')
const _onDrain = Symbol('_onDrain')
const _streams = Symbol('_streams')
class Pipeline extends Minipass {
  constructor (opts, ...streams) {
    if (isStream(opts)) {
      streams.unshift(opts)
      opts = {}
    }

    super(opts)
    this[_streams] = []
    if (streams.length)
      this.push(...streams)
  }

  [_linkStreams] (streams) {
    // reduce takes (left,right), and we return right to make it the
    // new left value.
    return streams.reduce((src, dest) => {
      src.on('error', er => dest.emit('error', er))
      src.pipe(dest)
      return dest
    })
  }

  push (...streams) {
    this[_streams].push(...streams)
    if (this[_tail])
      streams.unshift(this[_tail])

    const linkRet = this[_linkStreams](streams)

    this[_setTail](linkRet)
    if (!this[_head])
      this[_setHead](streams[0])
  }

  unshift (...streams) {
    this[_streams].unshift(...streams)
    if (this[_head])
      streams.push(this[_head])

    const linkRet = this[_linkStreams](streams)
    this[_setHead](streams[0])
    if (!this[_tail])
      this[_setTail](linkRet)
  }

  destroy (er) {
    // set fire to the whole thing.
    this[_streams].forEach(s =>
      typeof s.destroy === 'function' && s.destroy())
    return super.destroy(er)
  }

  // readable interface -> tail
  [_setTail] (stream) {
    this[_tail] = stream
    stream.on('error', er => this[_onError](stream, er))
    stream.on('data', chunk => this[_onData](stream, chunk))
    stream.on('end', () => this[_onEnd](stream))
    stream.on('finish', () => this[_onEnd](stream))
  }

  // errors proxied down the pipeline
  // they're considered part of the "read" interface
  [_onError] (stream, er) {
    if (stream === this[_tail])
      this.emit('error', er)
  }
  [_onData] (stream, chunk) {
    if (stream === this[_tail])
      super.write(chunk)
  }
  [_onEnd] (stream) {
    if (stream === this[_tail])
      super.end()
  }
  pause () {
    super.pause()
    return this[_tail] && this[_tail].pause && this[_tail].pause()
  }

  // NB: Minipass calls its internal private [RESUME] method during
  // pipe drains, to avoid hazards where stream.resume() is overridden.
  // Thus, we need to listen to the resume *event*, not override the
  // resume() method, and proxy *that* to the tail.
  emit (ev, ...args) {
    if (ev === 'resume' && this[_tail] && this[_tail].resume)
      this[_tail].resume()
    return super.emit(ev, ...args)
  }

  // writable interface -> head
  [_setHead] (stream) {
    this[_head] = stream
    stream.on('drain', () => this[_onDrain](stream))
  }
  [_onDrain] (stream) {
    if (stream === this[_head])
      this.emit('drain')
  }
  write (chunk, enc, cb) {
    return this[_head].write(chunk, enc, cb) &&
      (this.flowing || this.buffer.length === 0)
  }
  end (chunk, enc, cb) {
    this[_head].end(chunk, enc, cb)
    return this
  }
}

module.exports = Pipeline

}, function(modId) {var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046642262);
})()
//miniprogram-npm-outsideDeps=["minipass","events"]
//# sourceMappingURL=index.js.map