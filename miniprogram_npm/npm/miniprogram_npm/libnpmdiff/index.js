module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046642207, function(require, module, exports) {
const pacote = require('pacote')

const formatDiff = require('./format-diff.js')
const getTarball = require('./tarball.js')
const untar = require('./untar.js')

// TODO: we test this condition in the diff command
// so this error probably doesnt need to be here. Or
// if it does we should figure out a standard code
// so we can catch it in the cli and display it consistently
const argsError = () =>
  Object.assign(
    new TypeError('libnpmdiff needs two arguments to compare'),
    { code: 'EDIFFARGS' }
  )
const diff = async (specs, opts = {}) => {
  if (specs.length !== 2) {
    throw argsError()
  }

  const [
    aManifest,
    bManifest,
  ] =
    await Promise.all(specs.map(spec => pacote.manifest(spec, opts)))

  const versions = {
    a: aManifest.version,
    b: bManifest.version,
  }

  // fetches tarball using pacote
  const [a, b] = await Promise.all([
    getTarball(aManifest, opts),
    getTarball(bManifest, opts),
  ])

  // read all files
  // populates `files` and `refs`
  const {
    files,
    refs,
  } = await untar([
    {
      prefix: 'a/',
      item: a,
    },
    {
      prefix: 'b/',
      item: b,
    },
  ], opts)

  return formatDiff({
    files,
    opts,
    refs,
    versions,
  })
}

module.exports = diff

}, function(modId) {var map = {"./format-diff.js":1653046642208,"./tarball.js":1653046642210,"./untar.js":1653046642211}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642208, function(require, module, exports) {
const EOL = '\n'

const colorizeDiff = require('@npmcli/disparity-colors')
const jsDiff = require('diff')

const shouldPrintPatch = require('./should-print-patch.js')

const formatDiff = ({ files, opts = {}, refs, versions }) => {
  let res = ''
  const srcPrefix = opts.diffNoPrefix ? '' : opts.diffSrcPrefix || 'a/'
  const dstPrefix = opts.diffNoPrefix ? '' : opts.diffDstPrefix || 'b/'

  for (const filename of files.values()) {
    const names = {
      a: `${srcPrefix}${filename}`,
      b: `${dstPrefix}${filename}`,
    }

    let fileMode = ''
    const filenames = {
      a: refs.get(`a/${filename}`),
      b: refs.get(`b/${filename}`),
    }
    const contents = {
      a: filenames.a && filenames.a.content,
      b: filenames.b && filenames.b.content,
    }
    const modes = {
      a: filenames.a && filenames.a.mode,
      b: filenames.b && filenames.b.mode,
    }

    if (contents.a === contents.b && modes.a === modes.b) {
      continue
    }

    if (opts.diffNameOnly) {
      res += `${filename}${EOL}`
      continue
    }

    let patch = ''
    let headerLength = 0
    const header = str => {
      headerLength++
      patch += `${str}${EOL}`
    }

    // manually build a git diff-compatible header
    header(`diff --git ${names.a} ${names.b}`)
    if (modes.a === modes.b) {
      fileMode = filenames.a.mode
    } else {
      if (modes.a && !modes.b) {
        header(`deleted file mode ${modes.a}`)
      } else if (!modes.a && modes.b) {
        header(`new file mode ${modes.b}`)
      } else {
        header(`old mode ${modes.a}`)
        header(`new mode ${modes.b}`)
      }
    }
    /* eslint-disable-next-line max-len */
    header(`index ${opts.tagVersionPrefix || 'v'}${versions.a}..${opts.tagVersionPrefix || 'v'}${versions.b} ${fileMode}`)

    if (shouldPrintPatch(filename)) {
      patch += jsDiff.createTwoFilesPatch(
        names.a,
        names.b,
        contents.a || '',
        contents.b || '',
        '',
        '',
        {
          context: opts.diffUnified === 0 ? 0 : opts.diffUnified || 3,
          ignoreWhitespace: opts.diffIgnoreAllSpace,
        }
      ).replace(
        '===================================================================\n',
        ''
      ).replace(/\t\n/g, '\n') // strip trailing tabs
      headerLength += 2
    } else {
      header(`--- ${names.a}`)
      header(`+++ ${names.b}`)
    }

    res += (opts.color
      ? colorizeDiff(patch, { headerLength })
      : patch)
  }

  return res.trim()
}

module.exports = formatDiff

}, function(modId) { var map = {"./should-print-patch.js":1653046642209}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642209, function(require, module, exports) {
const { basename, extname } = require('path')

const binaryExtensions = require('binary-extensions')

// we should try to print patches as long as the
// extension is not identified as binary files
const shouldPrintPatch = (path, opts = {}) => {
  if (opts.diffText) {
    return true
  }

  const filename = basename(path)
  const extension = (
    filename.startsWith('.')
      ? filename
      : extname(filename)
  ).substr(1)

  return !binaryExtensions.includes(extension)
}

module.exports = shouldPrintPatch

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642210, function(require, module, exports) {
const { relative } = require('path')

const npa = require('npm-package-arg')
const pkgContents = require('@npmcli/installed-package-contents')
const pacote = require('pacote')
const { tarCreateOptions } = pacote.DirFetcher
const tar = require('tar')

// returns a simplified tarball when reading files from node_modules folder,
// thus avoiding running the prepare scripts and the extra logic from packlist
const nodeModulesTarball = (manifest, opts) =>
  pkgContents({ path: manifest._resolved, depth: 1 })
    .then(files =>
      files.map(file => relative(manifest._resolved, file))
    )
    .then(files =>
      tar.c(tarCreateOptions(manifest), files).concat()
    )

const tarball = (manifest, opts) => {
  const resolved = manifest._resolved
  const where = opts.where || process.cwd()

  const fromNodeModules = npa(resolved).type === 'directory'
    && /node_modules[\\/](@[^\\/]+\/)?[^\\/]+[\\/]?$/.test(relative(where, resolved))

  if (fromNodeModules) {
    return nodeModulesTarball(manifest, opts)
  }

  return pacote.tarball(manifest._resolved, opts)
}

module.exports = tarball

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642211, function(require, module, exports) {
const tar = require('tar')
const minimatch = require('minimatch')

const normalizeMatch = str => str
  .replace(/\\+/g, '/')
  .replace(/^\.\/|^\./, '')

// files and refs are mutating params
// filterFiles, item, prefix and opts are read-only options
const untar = ({ files, refs }, { filterFiles, item, prefix }) => {
  tar.list({
    filter: (path, entry) => {
      const fileMatch = () =>
        (!filterFiles.length ||
          filterFiles.some(f => {
            const pattern = normalizeMatch(f)
            return minimatch(
              normalizeMatch(path),
              `{package/,}${pattern}`,
              { matchBase: pattern.startsWith('*') }
            )
          }))

      // expands usage of simple path filters, e.g: lib or src/
      const folderMatch = () =>
        filterFiles.some(f =>
          normalizeMatch(path).startsWith(normalizeMatch(f)) ||
          normalizeMatch(path).startsWith(`package/${normalizeMatch(f)}`))

      if (
        entry.type === 'File' &&
        (fileMatch() || folderMatch())
      ) {
        const key = path.replace(/^[^/]+\/?/, '')
        files.add(key)

        // should skip reading file when using --name-only option
        let content
        try {
          entry.setEncoding('utf8')
          content = entry.concat()
        } catch (e) {
          /* istanbul ignore next */
          throw Object.assign(
            new Error('failed to read files'),
            { code: 'EDIFFUNTAR' }
          )
        }

        refs.set(`${prefix}${key}`, {
          content,
          mode: `100${entry.mode.toString(8)}`,
        })
        return true
      }
    },
  })
    .on('error', /* istanbul ignore next */ e => {
      throw e
    })
    .end(item)
}

const readTarballs = async (tarballs, opts = {}) => {
  const files = new Set()
  const refs = new Map()
  const arr = [].concat(tarballs)

  const filterFiles = opts.diffFiles || []

  for (const i of arr) {
    untar({
      files,
      refs,
    }, {
      item: i.item,
      prefix: i.prefix,
      filterFiles,
    })
  }

  // await to read all content from included files
  const allRefs = [...refs.values()]
  const contents = await Promise.all(allRefs.map(async ref => ref.content))

  contents.forEach((content, index) => {
    allRefs[index].content = content
  })

  return {
    files,
    refs,
  }
}

module.exports = readTarballs

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046642207);
})()
//miniprogram-npm-outsideDeps=["pacote","@npmcli/disparity-colors","diff","path","binary-extensions","npm-package-arg","@npmcli/installed-package-contents","tar","minimatch"]
//# sourceMappingURL=index.js.map