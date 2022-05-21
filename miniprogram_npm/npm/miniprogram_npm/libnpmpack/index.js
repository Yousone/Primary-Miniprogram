module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046642223, function(require, module, exports) {


const pacote = require('pacote')
const npa = require('npm-package-arg')
const runScript = require('@npmcli/run-script')
const path = require('path')
const util = require('util')
const writeFile = util.promisify(require('fs').writeFile)

module.exports = pack
async function pack (spec = 'file:.', opts = {}) {
  // gets spec
  spec = npa(spec)

  const manifest = await pacote.manifest(spec, opts)

  // Default to true if no log options passed, set to false if we're in silent
  // mode
  const banner = !opts.silent

  if (spec.type === 'directory') {
    // prepack
    await runScript({
      ...opts,
      event: 'prepack',
      path: spec.fetchSpec,
      stdio: 'inherit',
      pkg: manifest,
      banner,
    })
  }

  // packs tarball
  const tarball = await pacote.tarball(manifest._resolved, {
    ...opts,
    integrity: manifest._integrity,
  })

  // check for explicit `false` so the default behavior is to skip writing to disk
  if (opts.dryRun === false) {
    const filename = `${manifest.name}-${manifest.version}.tgz`
      .replace(/^@/, '').replace(/\//, '-')
    const destination = path.resolve(opts.packDestination, filename)
    await writeFile(destination, tarball)
  }

  if (spec.type === 'directory') {
    // postpack
    await runScript({
      ...opts,
      event: 'postpack',
      path: spec.fetchSpec,
      stdio: 'inherit',
      pkg: manifest,
      banner,
      env: {
        npm_package_from: tarball.from,
        npm_package_resolved: tarball.resolved,
        npm_package_integrity: tarball.integrity,
      },
    })
  }

  return tarball
}

}, function(modId) {var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046642223);
})()
//miniprogram-npm-outsideDeps=["pacote","npm-package-arg","@npmcli/run-script","path","util","fs"]
//# sourceMappingURL=index.js.map