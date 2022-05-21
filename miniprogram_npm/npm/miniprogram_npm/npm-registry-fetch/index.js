module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046642306, function(require, module, exports) {


const { HttpErrorAuthOTP } = require('./errors.js')
const checkResponse = require('./check-response.js')
const getAuth = require('./auth.js')
const fetch = require('make-fetch-happen')
const JSONStream = require('minipass-json-stream')
const npa = require('npm-package-arg')
const qs = require('querystring')
const url = require('url')
const zlib = require('minizlib')
const Minipass = require('minipass')

const defaultOpts = require('./default-opts.js')

// WhatWG URL throws if it's not fully resolved
const urlIsValid = u => {
  try {
    return !!new url.URL(u)
  } catch (_) {
    return false
  }
}

module.exports = regFetch
function regFetch (uri, /* istanbul ignore next */ opts_ = {}) {
  const opts = {
    ...defaultOpts,
    ...opts_,
  }

  // if we did not get a fully qualified URI, then we look at the registry
  // config or relevant scope to resolve it.
  const uriValid = urlIsValid(uri)
  let registry = opts.registry || defaultOpts.registry
  if (!uriValid) {
    registry = opts.registry = (
      (opts.spec && pickRegistry(opts.spec, opts)) ||
      opts.registry ||
      registry
    )
    uri = `${
      registry.trim().replace(/\/?$/g, '')
    }/${
      uri.trim().replace(/^\//, '')
    }`
    // asserts that this is now valid
    new url.URL(uri)
  }

  const method = opts.method || 'GET'

  // through that takes into account the scope, the prefix of `uri`, etc
  const startTime = Date.now()
  const auth = getAuth(uri, opts)
  const headers = getHeaders(uri, auth, opts)
  let body = opts.body
  const bodyIsStream = Minipass.isStream(body)
  const bodyIsPromise = body &&
    typeof body === 'object' &&
    typeof body.then === 'function'

  if (
    body && !bodyIsStream && !bodyIsPromise && typeof body !== 'string' && !Buffer.isBuffer(body)
  ) {
    headers['content-type'] = headers['content-type'] || 'application/json'
    body = JSON.stringify(body)
  } else if (body && !headers['content-type']) {
    headers['content-type'] = 'application/octet-stream'
  }

  if (opts.gzip) {
    headers['content-encoding'] = 'gzip'
    if (bodyIsStream) {
      const gz = new zlib.Gzip()
      body.on('error', /* istanbul ignore next: unlikely and hard to test */
        err => gz.emit('error', err))
      body = body.pipe(gz)
    } else if (!bodyIsPromise) {
      body = new zlib.Gzip().end(body).concat()
    }
  }

  const parsed = new url.URL(uri)

  if (opts.query) {
    const q = typeof opts.query === 'string' ? qs.parse(opts.query)
      : opts.query

    Object.keys(q).forEach(key => {
      if (q[key] !== undefined) {
        parsed.searchParams.set(key, q[key])
      }
    })
    uri = url.format(parsed)
  }

  if (parsed.searchParams.get('write') === 'true' && method === 'GET') {
    // do not cache, because this GET is fetching a rev that will be
    // used for a subsequent PUT or DELETE, so we need to conditionally
    // update cache.
    opts.offline = false
    opts.preferOffline = false
    opts.preferOnline = true
  }

  const doFetch = async body => {
    const p = fetch(uri, {
      agent: opts.agent,
      algorithms: opts.algorithms,
      body,
      cache: getCacheMode(opts),
      cachePath: opts.cache,
      ca: opts.ca,
      cert: opts.cert,
      headers,
      integrity: opts.integrity,
      key: opts.key,
      localAddress: opts.localAddress,
      maxSockets: opts.maxSockets,
      memoize: opts.memoize,
      method: method,
      noProxy: opts.noProxy,
      proxy: opts.httpsProxy || opts.proxy,
      retry: opts.retry ? opts.retry : {
        retries: opts.fetchRetries,
        factor: opts.fetchRetryFactor,
        minTimeout: opts.fetchRetryMintimeout,
        maxTimeout: opts.fetchRetryMaxtimeout,
      },
      strictSSL: opts.strictSSL,
      timeout: opts.timeout || 30 * 1000,
    }).then(res => checkResponse({
      method,
      uri,
      res,
      registry,
      startTime,
      auth,
      opts,
    }))

    if (typeof opts.otpPrompt === 'function') {
      return p.catch(async er => {
        if (er instanceof HttpErrorAuthOTP) {
          let otp
          // if otp fails to complete, we fail with that failure
          try {
            otp = await opts.otpPrompt()
          } catch (_) {
            // ignore this error
          }
          // if no otp provided, or otpPrompt errored, throw the original HTTP error
          if (!otp) {
            throw er
          }
          return regFetch(uri, { ...opts, otp })
        }
        throw er
      })
    } else {
      return p
    }
  }

  return Promise.resolve(body).then(doFetch)
}

module.exports.json = fetchJSON
function fetchJSON (uri, opts) {
  return regFetch(uri, opts).then(res => res.json())
}

module.exports.json.stream = fetchJSONStream
function fetchJSONStream (uri, jsonPath,
  /* istanbul ignore next */ opts_ = {}) {
  const opts = { ...defaultOpts, ...opts_ }
  const parser = JSONStream.parse(jsonPath, opts.mapJSON)
  regFetch(uri, opts).then(res =>
    res.body.on('error',
      /* istanbul ignore next: unlikely and difficult to test */
      er => parser.emit('error', er)).pipe(parser)
  ).catch(er => parser.emit('error', er))
  return parser
}

module.exports.pickRegistry = pickRegistry
function pickRegistry (spec, opts = {}) {
  spec = npa(spec)
  let registry = spec.scope &&
    opts[spec.scope.replace(/^@?/, '@') + ':registry']

  if (!registry && opts.scope) {
    registry = opts[opts.scope.replace(/^@?/, '@') + ':registry']
  }

  if (!registry) {
    registry = opts.registry || defaultOpts.registry
  }

  return registry
}

function getCacheMode (opts) {
  return opts.offline ? 'only-if-cached'
    : opts.preferOffline ? 'force-cache'
    : opts.preferOnline ? 'no-cache'
    : 'default'
}

function getHeaders (uri, auth, opts) {
  const headers = Object.assign({
    'user-agent': opts.userAgent,
  }, opts.headers || {})

  if (opts.scope) {
    headers['npm-scope'] = opts.scope
  }

  if (opts.npmSession) {
    headers['npm-session'] = opts.npmSession
  }

  if (opts.npmCommand) {
    headers['npm-command'] = opts.npmCommand
  }

  // If a tarball is hosted on a different place than the manifest, only send
  // credentials on `alwaysAuth`
  if (auth.token) {
    headers.authorization = `Bearer ${auth.token}`
  } else if (auth.auth) {
    headers.authorization = `Basic ${auth.auth}`
  }

  if (opts.otp) {
    headers['npm-otp'] = opts.otp
  }

  return headers
}

}, function(modId) {var map = {"./errors.js":1653046642307,"./check-response.js":1653046642308,"./auth.js":1653046642311,"./default-opts.js":1653046642309}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642307, function(require, module, exports) {


const url = require('url')

function packageName (href) {
  try {
    let basePath = new url.URL(href).pathname.substr(1)
    if (!basePath.match(/^-/)) {
      basePath = basePath.split('/')
      var index = basePath.indexOf('_rewrite')
      if (index === -1) {
        index = basePath.length - 1
      } else {
        index++
      }
      return decodeURIComponent(basePath[index])
    }
  } catch (_) {
    // this is ok
  }
}

class HttpErrorBase extends Error {
  constructor (method, res, body, spec) {
    super()
    this.name = this.constructor.name
    this.headers = res.headers.raw()
    this.statusCode = res.status
    this.code = `E${res.status}`
    this.method = method
    this.uri = res.url
    this.body = body
    this.pkgid = spec ? spec.toString() : packageName(res.url)
  }
}
module.exports.HttpErrorBase = HttpErrorBase

class HttpErrorGeneral extends HttpErrorBase {
  constructor (method, res, body, spec) {
    super(method, res, body, spec)
    this.message = `${res.status} ${res.statusText} - ${
      this.method.toUpperCase()
    } ${
      this.spec || this.uri
    }${
      (body && body.error) ? ' - ' + body.error : ''
    }`
    Error.captureStackTrace(this, HttpErrorGeneral)
  }
}
module.exports.HttpErrorGeneral = HttpErrorGeneral

class HttpErrorAuthOTP extends HttpErrorBase {
  constructor (method, res, body, spec) {
    super(method, res, body, spec)
    this.message = 'OTP required for authentication'
    this.code = 'EOTP'
    Error.captureStackTrace(this, HttpErrorAuthOTP)
  }
}
module.exports.HttpErrorAuthOTP = HttpErrorAuthOTP

class HttpErrorAuthIPAddress extends HttpErrorBase {
  constructor (method, res, body, spec) {
    super(method, res, body, spec)
    this.message = 'Login is not allowed from your IP address'
    this.code = 'EAUTHIP'
    Error.captureStackTrace(this, HttpErrorAuthIPAddress)
  }
}
module.exports.HttpErrorAuthIPAddress = HttpErrorAuthIPAddress

class HttpErrorAuthUnknown extends HttpErrorBase {
  constructor (method, res, body, spec) {
    super(method, res, body, spec)
    this.message = 'Unable to authenticate, need: ' + res.headers.get('www-authenticate')
    Error.captureStackTrace(this, HttpErrorAuthUnknown)
  }
}
module.exports.HttpErrorAuthUnknown = HttpErrorAuthUnknown

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642308, function(require, module, exports) {


const errors = require('./errors.js')
const { Response } = require('minipass-fetch')
const defaultOpts = require('./default-opts.js')
const log = require('proc-log')

/* eslint-disable-next-line max-len */
const moreInfoUrl = 'https://github.com/npm/cli/wiki/No-auth-for-URI,-but-auth-present-for-scoped-registry'
const checkResponse =
  async ({ method, uri, res, startTime, auth, opts }) => {
    opts = { ...defaultOpts, ...opts }
    if (res.headers.has('npm-notice') && !res.headers.has('x-local-cache')) {
      log.notice('', res.headers.get('npm-notice'))
    }

    if (res.status >= 400) {
      logRequest(method, res, startTime)
      if (auth && auth.scopeAuthKey && !auth.token && !auth.auth) {
      // we didn't have auth for THIS request, but we do have auth for
      // requests to the registry indicated by the spec's scope value.
      // Warn the user.
        log.warn('registry', `No auth for URI, but auth present for scoped registry.

URI: ${uri}
Scoped Registry Key: ${auth.scopeAuthKey}

More info here: ${moreInfoUrl}`)
      }
      return checkErrors(method, res, startTime, opts)
    } else {
      res.body.on('end', () => logRequest(method, res, startTime, opts))
      if (opts.ignoreBody) {
        res.body.resume()
        return new Response(null, res)
      }
      return res
    }
  }
module.exports = checkResponse

function logRequest (method, res, startTime) {
  const elapsedTime = Date.now() - startTime
  const attempt = res.headers.get('x-fetch-attempts')
  const attemptStr = attempt && attempt > 1 ? ` attempt #${attempt}` : ''
  const cacheStatus = res.headers.get('x-local-cache-status')
  const cacheStr = cacheStatus ? ` (cache ${cacheStatus})` : ''

  let urlStr
  try {
    const { URL } = require('url')
    const url = new URL(res.url)
    if (url.password) {
      url.password = '***'
    }

    urlStr = url.toString()
  } catch (er) {
    urlStr = res.url
  }

  log.http(
    'fetch',
    `${method.toUpperCase()} ${res.status} ${urlStr} ${elapsedTime}ms${attemptStr}${cacheStr}`
  )
}

function checkErrors (method, res, startTime, opts) {
  return res.buffer()
    .catch(() => null)
    .then(body => {
      let parsed = body
      try {
        parsed = JSON.parse(body.toString('utf8'))
      } catch (e) {}
      if (res.status === 401 && res.headers.get('www-authenticate')) {
        const auth = res.headers.get('www-authenticate')
          .split(/,\s*/)
          .map(s => s.toLowerCase())
        if (auth.indexOf('ipaddress') !== -1) {
          throw new errors.HttpErrorAuthIPAddress(
            method, res, parsed, opts.spec
          )
        } else if (auth.indexOf('otp') !== -1) {
          throw new errors.HttpErrorAuthOTP(
            method, res, parsed, opts.spec
          )
        } else {
          throw new errors.HttpErrorAuthUnknown(
            method, res, parsed, opts.spec
          )
        }
      } else if (
        res.status === 401 &&
        body != null &&
        /one-time pass/.test(body.toString('utf8'))
      ) {
        // Heuristic for malformed OTP responses that don't include the
        // www-authenticate header.
        throw new errors.HttpErrorAuthOTP(
          method, res, parsed, opts.spec
        )
      } else {
        throw new errors.HttpErrorGeneral(
          method, res, parsed, opts.spec
        )
      }
    })
}

}, function(modId) { var map = {"./errors.js":1653046642307,"./default-opts.js":1653046642309}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642309, function(require, module, exports) {
const pkg = require('../package.json')
module.exports = {
  maxSockets: 12,
  method: 'GET',
  registry: 'https://registry.npmjs.org/',
  timeout: 5 * 60 * 1000, // 5 minutes
  strictSSL: true,
  noProxy: process.env.NOPROXY,
  userAgent: `${pkg.name
    }@${
      pkg.version
    }/node@${
      process.version
    }+${
      process.arch
    } (${
      process.platform
    })`,
}

}, function(modId) { var map = {"../package.json":1653046642310}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642310, function(require, module, exports) {
module.exports = {
  "name": "npm-registry-fetch",
  "version": "13.0.1",
  "description": "Fetch-based http client for use with npm registry APIs",
  "main": "lib",
  "files": [
    "bin",
    "lib"
  ],
  "scripts": {
    "eslint": "eslint",
    "lint": "eslint '**/*.js'",
    "lintfix": "npm run lint -- --fix",
    "prepublishOnly": "git push origin --follow-tags",
    "preversion": "npm test",
    "postversion": "npm publish",
    "test": "tap",
    "posttest": "npm run lint",
    "npmclilint": "npmcli-lint",
    "postsnap": "npm run lintfix --",
    "postlint": "npm-template-check",
    "snap": "tap",
    "template-copy": "npm-template-copy --force"
  },
  "repository": "https://github.com/npm/npm-registry-fetch",
  "keywords": [
    "npm",
    "registry",
    "fetch"
  ],
  "author": "GitHub Inc.",
  "license": "ISC",
  "dependencies": {
    "make-fetch-happen": "^10.0.3",
    "minipass": "^3.1.6",
    "minipass-fetch": "^2.0.1",
    "minipass-json-stream": "^1.0.1",
    "minizlib": "^2.1.2",
    "npm-package-arg": "^9.0.0",
    "proc-log": "^2.0.0"
  },
  "devDependencies": {
    "@npmcli/template-oss": "^2.8.1",
    "cacache": "^15.3.0",
    "nock": "^13.2.4",
    "require-inject": "^1.4.4",
    "ssri": "^8.0.1",
    "tap": "^15.1.6"
  },
  "tap": {
    "check-coverage": true,
    "test-ignore": "test[\\\\/](util|cache)[\\\\/]"
  },
  "engines": {
    "node": "^12.13.0 || ^14.15.0 || >=16"
  },
  "templateOSS": {
    "version": "2.8.1"
  }
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642311, function(require, module, exports) {

const npa = require('npm-package-arg')
const { URL } = require('url')

// Find the longest registry key that is used for some kind of auth
// in the options.
const regKeyFromURI = (uri, opts) => {
  const parsed = new URL(uri)
  // try to find a config key indicating we have auth for this registry
  // can be one of :_authToken, :_auth, or :_password and :username
  // We walk up the "path" until we're left with just //<host>[:<port>],
  // stopping when we reach '//'.
  let regKey = `//${parsed.host}${parsed.pathname}`
  while (regKey.length > '//'.length) {
    // got some auth for this URI
    if (hasAuth(regKey, opts)) {
      return regKey
    }

    // can be either //host/some/path/:_auth or //host/some/path:_auth
    // walk up by removing EITHER what's after the slash OR the slash itself
    regKey = regKey.replace(/([^/]+|\/)$/, '')
  }
}

const hasAuth = (regKey, opts) => (
  opts[`${regKey}:_authToken`] ||
  opts[`${regKey}:_auth`] ||
  opts[`${regKey}:username`] && opts[`${regKey}:_password`]
)

const sameHost = (a, b) => {
  const parsedA = new URL(a)
  const parsedB = new URL(b)
  return parsedA.host === parsedB.host
}

const getRegistry = opts => {
  const { spec } = opts
  const { scope: specScope, subSpec } = spec ? npa(spec) : {}
  const subSpecScope = subSpec && subSpec.scope
  const scope = subSpec ? subSpecScope : specScope
  const scopeReg = scope && opts[`${scope}:registry`]
  return scopeReg || opts.registry
}

const getAuth = (uri, opts = {}) => {
  const { forceAuth } = opts
  if (!uri) {
    throw new Error('URI is required')
  }
  const regKey = regKeyFromURI(uri, forceAuth || opts)

  // we are only allowed to use what's in forceAuth if specified
  if (forceAuth && !regKey) {
    return new Auth({
      scopeAuthKey: null,
      token: forceAuth._authToken || forceAuth.token,
      username: forceAuth.username,
      password: forceAuth._password || forceAuth.password,
      auth: forceAuth._auth || forceAuth.auth,
    })
  }

  // no auth for this URI, but might have it for the registry
  if (!regKey) {
    const registry = getRegistry(opts)
    if (registry && uri !== registry && sameHost(uri, registry)) {
      return getAuth(registry, opts)
    } else if (registry !== opts.registry) {
      // If making a tarball request to a different base URI than the
      // registry where we logged in, but the same auth SHOULD be sent
      // to that artifact host, then we track where it was coming in from,
      // and warn the user if we get a 4xx error on it.
      const scopeAuthKey = regKeyFromURI(registry, opts)
      return new Auth({ scopeAuthKey })
    }
  }

  const {
    [`${regKey}:_authToken`]: token,
    [`${regKey}:username`]: username,
    [`${regKey}:_password`]: password,
    [`${regKey}:_auth`]: auth,
  } = opts

  return new Auth({
    scopeAuthKey: null,
    token,
    auth,
    username,
    password,
  })
}

class Auth {
  constructor ({ token, auth, username, password, scopeAuthKey }) {
    this.scopeAuthKey = scopeAuthKey
    this.token = null
    this.auth = null
    this.isBasicAuth = false
    if (token) {
      this.token = token
    } else if (auth) {
      this.auth = auth
    } else if (username && password) {
      const p = Buffer.from(password, 'base64').toString('utf8')
      this.auth = Buffer.from(`${username}:${p}`, 'utf8').toString('base64')
      this.isBasicAuth = true
    }
  }
}

module.exports = getAuth

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046642306);
})()
//miniprogram-npm-outsideDeps=["make-fetch-happen","minipass-json-stream","npm-package-arg","querystring","url","minizlib","minipass","minipass-fetch","proc-log"]
//# sourceMappingURL=index.js.map