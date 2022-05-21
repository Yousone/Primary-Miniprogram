module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046642224, function(require, module, exports) {
module.exports = {
  publish: require('./publish.js'),
  unpublish: require('./unpublish.js'),
}

}, function(modId) {var map = {"./publish.js":1653046642225,"./unpublish.js":1653046642226}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642225, function(require, module, exports) {
const { fixer } = require('normalize-package-data')
const npmFetch = require('npm-registry-fetch')
const npa = require('npm-package-arg')
const semver = require('semver')
const { URL } = require('url')
const ssri = require('ssri')

const publish = async (manifest, tarballData, opts) => {
  if (manifest.private) {
    throw Object.assign(
      new Error(`This package has been marked as private
Remove the 'private' field from the package.json to publish it.`),
      { code: 'EPRIVATE' }
    )
  }

  // spec is used to pick the appropriate registry/auth combo
  const spec = npa.resolve(manifest.name, manifest.version)
  opts = {
    defaultTag: 'latest',
    // if scoped, restricted by default
    access: spec.scope ? 'restricted' : 'public',
    algorithms: ['sha512'],
    ...opts,
    spec,
  }

  const reg = npmFetch.pickRegistry(spec, opts)
  const pubManifest = patchManifest(manifest, opts)

  // registry-frontdoor cares about the access level,
  // which is only configurable for scoped packages
  if (!spec.scope && opts.access === 'restricted') {
    throw Object.assign(
      new Error("Can't restrict access to unscoped packages."),
      { code: 'EUNSCOPED' }
    )
  }

  const metadata = buildMetadata(reg, pubManifest, tarballData, opts)

  try {
    return await npmFetch(spec.escapedName, {
      ...opts,
      method: 'PUT',
      body: metadata,
      ignoreBody: true,
    })
  } catch (err) {
    if (err.code !== 'E409') {
      throw err
    }
    // if E409, we attempt exactly ONE retry, to protect us
    // against malicious activity like trying to publish
    // a bunch of new versions of a package at the same time
    // and/or spamming the registry
    const current = await npmFetch.json(spec.escapedName, {
      ...opts,
      query: { write: true },
    })
    const newMetadata = patchMetadata(current, metadata)
    return npmFetch(spec.escapedName, {
      ...opts,
      method: 'PUT',
      body: newMetadata,
      ignoreBody: true,
    })
  }
}

const patchManifest = (_manifest, opts) => {
  const { npmVersion } = opts
  // we only update top-level fields, so a shallow clone is fine
  const manifest = { ..._manifest }

  manifest._nodeVersion = process.versions.node
  if (npmVersion) {
    manifest._npmVersion = npmVersion
  }

  fixer.fixNameField(manifest, { strict: true, allowLegacyCase: true })
  const version = semver.clean(manifest.version)
  if (!version) {
    throw Object.assign(
      new Error('invalid semver: ' + manifest.version),
      { code: 'EBADSEMVER' }
    )
  }
  manifest.version = version
  return manifest
}

const buildMetadata = (registry, manifest, tarballData, opts) => {
  const { access, defaultTag, algorithms } = opts
  const root = {
    _id: manifest.name,
    name: manifest.name,
    description: manifest.description,
    'dist-tags': {},
    versions: {},
    access,
  }

  root.versions[manifest.version] = manifest
  const tag = manifest.tag || defaultTag
  root['dist-tags'][tag] = manifest.version

  const tarballName = `${manifest.name}-${manifest.version}.tgz`
  const tarballURI = `${manifest.name}/-/${tarballName}`
  const integrity = ssri.fromData(tarballData, {
    algorithms: [...new Set(['sha1'].concat(algorithms))],
  })

  manifest._id = `${manifest.name}@${manifest.version}`
  manifest.dist = { ...manifest.dist }
  // Don't bother having sha1 in the actual integrity field
  manifest.dist.integrity = integrity.sha512[0].toString()
  // Legacy shasum support
  manifest.dist.shasum = integrity.sha1[0].hexDigest()

  // NB: the CLI always fetches via HTTPS if the registry is HTTPS,
  // regardless of what's here.  This makes it so that installing
  // from an HTTP-only mirror doesn't cause problems, though.
  manifest.dist.tarball = new URL(tarballURI, registry).href
    .replace(/^https:\/\//, 'http://')

  root._attachments = {}
  root._attachments[tarballName] = {
    content_type: 'application/octet-stream',
    data: tarballData.toString('base64'),
    length: tarballData.length,
  }

  return root
}

const patchMetadata = (current, newData) => {
  const curVers = Object.keys(current.versions || {})
    .map(v => semver.clean(v, true))
    .concat(Object.keys(current.time || {})
      .map(v => semver.valid(v, true) && semver.clean(v, true))
      .filter(v => v))

  const newVersion = Object.keys(newData.versions)[0]

  if (curVers.indexOf(newVersion) !== -1) {
    const { name: pkgid, version } = newData
    throw Object.assign(
      new Error(
        `Cannot publish ${pkgid}@${version} over existing version.`
      ), {
        code: 'EPUBLISHCONFLICT',
        pkgid,
        version,
      })
  }

  current.versions = current.versions || {}
  current.versions[newVersion] = newData.versions[newVersion]
  for (const i in newData) {
    switch (i) {
      // objects that copy over the new stuffs
      case 'dist-tags':
      case 'versions':
      case '_attachments':
        for (const j in newData[i]) {
          current[i] = current[i] || {}
          current[i][j] = newData[i][j]
        }
        break

      // copy
      default:
        current[i] = newData[i]
        break
    }
  }

  return current
}

module.exports = publish

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642226, function(require, module, exports) {


const npa = require('npm-package-arg')
const npmFetch = require('npm-registry-fetch')
const semver = require('semver')
const { URL } = require('url')

const unpublish = async (spec, opts) => {
  spec = npa(spec)
  // spec is used to pick the appropriate registry/auth combo.
  opts = {
    force: false,
    ...opts,
    spec,
  }

  try {
    const pkgUri = spec.escapedName
    const pkg = await npmFetch.json(pkgUri, {
      ...opts,
      query: { write: true },
    })

    const version = spec.rawSpec
    const allVersions = pkg.versions || {}
    const versionData = allVersions[version]

    const rawSpecs = (!spec.rawSpec || spec.rawSpec === '*')
    const onlyVersion = Object.keys(allVersions).length === 1
    const noVersions = !Object.keys(allVersions).length

    // if missing specific version,
    // assumed unpublished
    if (!versionData && !rawSpecs && !noVersions) {
      return true
    }

    // unpublish all versions of a package:
    // - no specs supplied "npm unpublish foo"
    // - all specs ("*") "npm unpublish foo@*"
    // - there was only one version
    // - has no versions field on packument
    if (rawSpecs || onlyVersion || noVersions) {
      await npmFetch(`${pkgUri}/-rev/${pkg._rev}`, {
        ...opts,
        method: 'DELETE',
        ignoreBody: true,
      })
      return true
    } else {
      const dist = allVersions[version].dist
      delete allVersions[version]

      const latestVer = pkg['dist-tags'].latest

      // deleting dist tags associated to version
      Object.keys(pkg['dist-tags']).forEach(tag => {
        if (pkg['dist-tags'][tag] === version) {
          delete pkg['dist-tags'][tag]
        }
      })

      if (latestVer === version) {
        pkg['dist-tags'].latest = Object.keys(
          allVersions
        ).sort(semver.compareLoose).pop()
      }

      delete pkg._revisions
      delete pkg._attachments

      // Update packument with removed versions
      await npmFetch(`${pkgUri}/-rev/${pkg._rev}`, {
        ...opts,
        method: 'PUT',
        body: pkg,
        ignoreBody: true,
      })

      // Remove the tarball itself
      const { _rev } = await npmFetch.json(pkgUri, {
        ...opts,
        query: { write: true },
      })
      const tarballUrl = new URL(dist.tarball).pathname.substr(1)
      await npmFetch(`${tarballUrl}/-rev/${_rev}`, {
        ...opts,
        method: 'DELETE',
        ignoreBody: true,
      })
      return true
    }
  } catch (err) {
    if (err.code !== 'E404') {
      throw err
    }

    return true
  }
}

module.exports = unpublish

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046642224);
})()
//miniprogram-npm-outsideDeps=["normalize-package-data","npm-registry-fetch","npm-package-arg","semver","url","ssri"]
//# sourceMappingURL=index.js.map