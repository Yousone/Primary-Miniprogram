module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046641879, function(require, module, exports) {
module.exports = require('./arborist/index.js')
module.exports.Arborist = module.exports
module.exports.Node = require('./node.js')
module.exports.Link = require('./link.js')
module.exports.Edge = require('./edge.js')
module.exports.Shrinkwrap = require('./shrinkwrap.js')
// XXX export the other classes, too.  shrinkwrap, diff, etc.
// they're handy!

}, function(modId) {var map = {"./arborist/index.js":1653046641880,"./node.js":1653046641898,"./link.js":1653046641896,"./edge.js":1653046641899,"./shrinkwrap.js":1653046641909}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641880, function(require, module, exports) {
// The arborist manages three trees:
// - actual
// - virtual
// - ideal
//
// The actual tree is what's present on disk in the node_modules tree
// and elsewhere that links may extend.
//
// The virtual tree is loaded from metadata (package.json and lock files).
//
// The ideal tree is what we WANT that actual tree to become.  This starts
// with the virtual tree, and then applies the options requesting
// add/remove/update actions.
//
// To reify a tree, we calculate a diff between the ideal and actual trees,
// and then turn the actual tree into the ideal tree by taking the actions
// required.  At the end of the reification process, the actualTree is
// updated to reflect the changes.
//
// Each tree has an Inventory at the root.  Shrinkwrap is tracked by Arborist
// instance.  It always refers to the actual tree, but is updated (and written
// to disk) on reification.

// Each of the mixin "classes" adds functionality, but are not dependent on
// constructor call order.  So, we just load them in an array, and build up
// the base class, so that the overall voltron class is easier to test and
// cover, and separation of concerns can be maintained.

const { resolve } = require('path')
const { homedir } = require('os')
const { depth } = require('treeverse')
const { saveTypeMap } = require('../add-rm-pkg-deps.js')

const mixins = [
  require('../tracker.js'),
  require('./pruner.js'),
  require('./deduper.js'),
  require('./audit.js'),
  require('./build-ideal-tree.js'),
  require('./load-workspaces.js'),
  require('./load-actual.js'),
  require('./load-virtual.js'),
  require('./rebuild.js'),
  require('./reify.js'),
]

const _workspacesEnabled = Symbol.for('workspacesEnabled')
const Base = mixins.reduce((a, b) => b(a), require('events'))
const getWorkspaceNodes = require('../get-workspace-nodes.js')

// if it's 1, 2, or 3, set it explicitly that.
// if undefined or null, set it null
// otherwise, throw.
const lockfileVersion = lfv => {
  if (lfv === 1 || lfv === 2 || lfv === 3) {
    return lfv
  }

  if (lfv === undefined || lfv === null) {
    return null
  }

  throw new TypeError('Invalid lockfileVersion config: ' + lfv)
}

class Arborist extends Base {
  constructor (options = {}) {
    process.emit('time', 'arborist:ctor')
    super(options)
    this.options = {
      nodeVersion: process.version,
      ...options,
      path: options.path || '.',
      cache: options.cache || `${homedir()}/.npm/_cacache`,
      packumentCache: options.packumentCache || new Map(),
      workspacesEnabled: options.workspacesEnabled !== false,
      lockfileVersion: lockfileVersion(options.lockfileVersion),
    }

    this[_workspacesEnabled] = this.options.workspacesEnabled

    if (options.saveType && !saveTypeMap.get(options.saveType)) {
      throw new Error(`Invalid saveType ${options.saveType}`)
    }
    this.cache = resolve(this.options.cache)
    this.path = resolve(this.options.path)
    process.emit('timeEnd', 'arborist:ctor')
  }

  // TODO: We should change these to static functions instead
  //   of methods for the next major version

  // returns an array of the actual nodes for all the workspaces
  workspaceNodes (tree, workspaces) {
    return getWorkspaceNodes(tree, workspaces)
  }

  // returns a set of workspace nodes and all their deps
  workspaceDependencySet (tree, workspaces, includeWorkspaceRoot) {
    const wsNodes = this.workspaceNodes(tree, workspaces)
    if (includeWorkspaceRoot) {
      for (const edge of tree.edgesOut.values()) {
        if (edge.type !== 'workspace' && edge.to) {
          wsNodes.push(edge.to)
        }
      }
    }
    const wsDepSet = new Set(wsNodes)
    const extraneous = new Set()
    for (const node of wsDepSet) {
      for (const edge of node.edgesOut.values()) {
        const dep = edge.to
        if (dep) {
          wsDepSet.add(dep)
          if (dep.isLink) {
            wsDepSet.add(dep.target)
          }
        }
      }
      for (const child of node.children.values()) {
        if (child.extraneous) {
          extraneous.add(child)
        }
      }
    }
    for (const extra of extraneous) {
      wsDepSet.add(extra)
    }

    return wsDepSet
  }

  // returns a set of root dependencies, excluding depdencies that are
  // exclusively workspace dependencies
  excludeWorkspacesDependencySet (tree) {
    const rootDepSet = new Set()
    depth({
      tree,
      visit: node => {
        for (const { to } of node.edgesOut.values()) {
          if (!to || to.isWorkspace) {
            continue
          }
          for (const edgeIn of to.edgesIn.values()) {
            if (edgeIn.from.isRoot || rootDepSet.has(edgeIn.from)) {
              rootDepSet.add(to)
            }
          }
        }
        return node
      },
      filter: node => node,
      getChildren: (node, tree) =>
        [...tree.edgesOut.values()].map(edge => edge.to),
    })
    return rootDepSet
  }
}

module.exports = Arborist

}, function(modId) { var map = {"../add-rm-pkg-deps.js":1653046641881,"../tracker.js":1653046641882,"./pruner.js":1653046641883,"./deduper.js":1653046641884,"./audit.js":1653046641885,"./build-ideal-tree.js":1653046641888,"./load-workspaces.js":1653046641915,"./load-actual.js":1653046641916,"./load-virtual.js":1653046641917,"./rebuild.js":1653046641918,"../get-workspace-nodes.js":1653046641920}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641881, function(require, module, exports) {
// add and remove dependency specs to/from pkg manifest

const log = require('proc-log')
const localeCompare = require('@isaacs/string-locale-compare')('en')

const add = ({ pkg, add, saveBundle, saveType }) => {
  for (const spec of add) {
    addSingle({ pkg, spec, saveBundle, saveType })
  }

  return pkg
}

// Canonical source of both the map between saveType and where it correlates to
// in the package, and the names of all our dependencies attributes
const saveTypeMap = new Map([
  ['dev', 'devDependencies'],
  ['optional', 'optionalDependencies'],
  ['prod', 'dependencies'],
  ['peerOptional', 'peerDependencies'],
  ['peer', 'peerDependencies'],
])

const addSingle = ({ pkg, spec, saveBundle, saveType }) => {
  const { name, rawSpec } = spec

  // if the user does not give us a type, we infer which type(s)
  // to keep based on the same order of priority we do when
  // building the tree as defined in the _loadDeps method of
  // the node class.
  if (!saveType) {
    saveType = inferSaveType(pkg, spec.name)
  }

  if (saveType === 'prod') {
    // a production dependency can only exist as production (rpj ensures it
    // doesn't coexist w/ optional)
    deleteSubKey(pkg, 'devDependencies', name, 'dependencies')
    deleteSubKey(pkg, 'peerDependencies', name, 'dependencies')
  } else if (saveType === 'dev') {
    // a dev dependency may co-exist as peer, or optional, but not production
    deleteSubKey(pkg, 'dependencies', name, 'devDependencies')
  } else if (saveType === 'optional') {
    // an optional dependency may co-exist as dev (rpj ensures it doesn't
    // coexist w/ prod)
    deleteSubKey(pkg, 'peerDependencies', name, 'optionalDependencies')
  } else { // peer or peerOptional is all that's left
    // a peer dependency may coexist as dev
    deleteSubKey(pkg, 'dependencies', name, 'peerDependencies')
    deleteSubKey(pkg, 'optionalDependencies', name, 'peerDependencies')
  }

  const depType = saveTypeMap.get(saveType)

  pkg[depType] = pkg[depType] || {}
  if (rawSpec !== '' || pkg[depType][name] === undefined) {
    pkg[depType][name] = rawSpec || '*'
  }
  if (saveType === 'optional') {
    // Affordance for previous npm versions that require this behaviour
    pkg.dependencies = pkg.dependencies || {}
    pkg.dependencies[name] = pkg.optionalDependencies[name]
  }

  if (saveType === 'peer' || saveType === 'peerOptional') {
    const pdm = pkg.peerDependenciesMeta || {}
    if (saveType === 'peer' && pdm[name] && pdm[name].optional) {
      pdm[name].optional = false
    } else if (saveType === 'peerOptional') {
      pdm[name] = pdm[name] || {}
      pdm[name].optional = true
      pkg.peerDependenciesMeta = pdm
    }
    // peerDeps are often also a devDep, so that they can be tested when
    // using package managers that don't auto-install peer deps
    if (pkg.devDependencies && pkg.devDependencies[name] !== undefined) {
      pkg.devDependencies[name] = pkg.peerDependencies[name]
    }
  }

  if (saveBundle && saveType !== 'peer' && saveType !== 'peerOptional') {
    // keep it sorted, keep it unique
    const bd = new Set(pkg.bundleDependencies || [])
    bd.add(spec.name)
    pkg.bundleDependencies = [...bd].sort(localeCompare)
  }
}

// Finds where the package is already in the spec and infers saveType from that
const inferSaveType = (pkg, name) => {
  for (const saveType of saveTypeMap.keys()) {
    if (hasSubKey(pkg, saveTypeMap.get(saveType), name)) {
      if (
        saveType === 'peerOptional' &&
        (!hasSubKey(pkg, 'peerDependenciesMeta', name) ||
        !pkg.peerDependenciesMeta[name].optional)
      ) {
        return 'peer'
      }
      return saveType
    }
  }
  return 'prod'
}

const { hasOwnProperty } = Object.prototype
const hasSubKey = (pkg, depType, name) => {
  return pkg[depType] && hasOwnProperty.call(pkg[depType], name)
}

// Removes a subkey and warns about it if it's being replaced
const deleteSubKey = (pkg, depType, name, replacedBy) => {
  if (hasSubKey(pkg, depType, name)) {
    if (replacedBy) {
      log.warn('idealTree', `Removing ${depType}.${name} in favor of ${replacedBy}.${name}`)
    }
    delete pkg[depType][name]

    // clean up peerDepsMeta if we are removing something from peerDependencies
    if (depType === 'peerDependencies' && pkg.peerDependenciesMeta) {
      delete pkg.peerDependenciesMeta[name]
      if (!Object.keys(pkg.peerDependenciesMeta).length) {
        delete pkg.peerDependenciesMeta
      }
    }

    if (!Object.keys(pkg[depType]).length) {
      delete pkg[depType]
    }
  }
}

const rm = (pkg, rm) => {
  for (const depType of new Set(saveTypeMap.values())) {
    for (const name of rm) {
      deleteSubKey(pkg, depType, name)
    }
  }
  if (pkg.bundleDependencies) {
    pkg.bundleDependencies = pkg.bundleDependencies
      .filter(name => !rm.includes(name))
    if (!pkg.bundleDependencies.length) {
      delete pkg.bundleDependencies
    }
  }
  return pkg
}

module.exports = { add, rm, saveTypeMap, hasSubKey }

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641882, function(require, module, exports) {
const _progress = Symbol('_progress')
const _onError = Symbol('_onError')
const npmlog = require('npmlog')

module.exports = cls => class Tracker extends cls {
  constructor (options = {}) {
    super(options)
    this[_progress] = new Map()
  }

  addTracker (section, subsection = null, key = null) {
    if (section === null || section === undefined) {
      this[_onError](`Tracker can't be null or undefined`)
    }

    if (key === null) {
      key = subsection
    }

    const hasTracker = this[_progress].has(section)
    const hasSubtracker = this[_progress].has(`${section}:${key}`)

    if (hasTracker && subsection === null) {
      // 0. existing tracker, no subsection
      this[_onError](`Tracker "${section}" already exists`)
    } else if (!hasTracker && subsection === null) {
      // 1. no existing tracker, no subsection
      // Create a new tracker from npmlog
      // starts progress bar
      if (this[_progress].size === 0) {
        npmlog.enableProgress()
      }

      this[_progress].set(section, npmlog.newGroup(section))
    } else if (!hasTracker && subsection !== null) {
      // 2. no parent tracker and subsection
      this[_onError](`Parent tracker "${section}" does not exist`)
    } else if (!hasTracker || !hasSubtracker) {
      // 3. existing parent tracker, no subsection tracker
      // Create a new subtracker in this[_progress] from parent tracker
      this[_progress].set(`${section}:${key}`,
        this[_progress].get(section).newGroup(`${section}:${subsection}`)
      )
    }
    // 4. existing parent tracker, existing subsection tracker
    // skip it
  }

  finishTracker (section, subsection = null, key = null) {
    if (section === null || section === undefined) {
      this[_onError](`Tracker can't be null or undefined`)
    }

    if (key === null) {
      key = subsection
    }

    const hasTracker = this[_progress].has(section)
    const hasSubtracker = this[_progress].has(`${section}:${key}`)

    // 0. parent tracker exists, no subsection
    // Finish parent tracker and remove from this[_progress]
    if (hasTracker && subsection === null) {
      // check if parent tracker does
      // not have any remaining children
      const keys = this[_progress].keys()
      for (const key of keys) {
        if (key.match(new RegExp(section + ':'))) {
          this.finishTracker(section, key)
        }
      }

      // remove parent tracker
      this[_progress].get(section).finish()
      this[_progress].delete(section)

      // remove progress bar if all
      // trackers are finished
      if (this[_progress].size === 0) {
        npmlog.disableProgress()
      }
    } else if (!hasTracker && subsection === null) {
      // 1. no existing parent tracker, no subsection
      this[_onError](`Tracker "${section}" does not exist`)
    } else if (!hasTracker || hasSubtracker) {
      // 2. subtracker exists
      // Finish subtracker and remove from this[_progress]
      this[_progress].get(`${section}:${key}`).finish()
      this[_progress].delete(`${section}:${key}`)
    }
    // 3. existing parent tracker, no subsection
  }

  [_onError] (msg) {
    npmlog.disableProgress()
    throw new Error(msg)
  }
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641883, function(require, module, exports) {
const _idealTreePrune = Symbol.for('idealTreePrune')
const _workspacesEnabled = Symbol.for('workspacesEnabled')
const _addNodeToTrashList = Symbol.for('addNodeToTrashList')

module.exports = cls => class Pruner extends cls {
  async prune (options = {}) {
    // allow the user to set options on the ctor as well.
    // XXX: deprecate separate method options objects.
    options = { ...this.options, ...options }

    await this.buildIdealTree(options)

    this[_idealTreePrune]()

    if (!this[_workspacesEnabled]) {
      const excludeNodes = this.excludeWorkspacesDependencySet(this.idealTree)
      for (const node of this.idealTree.inventory.values()) {
        if (
          node.parent !== null
          && !node.isProjectRoot
          && !excludeNodes.has(node)
        ) {
          this[_addNodeToTrashList](node)
        }
      }
    }

    return this.reify(options)
  }
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641884, function(require, module, exports) {
module.exports = cls => class Deduper extends cls {
  async dedupe (options = {}) {
    // allow the user to set options on the ctor as well.
    // XXX: deprecate separate method options objects.
    options = { ...this.options, ...options }
    const tree = await this.loadVirtual().catch(() => this.loadActual())
    const names = []
    for (const name of tree.inventory.query('name')) {
      if (tree.inventory.query('name', name).size > 1) {
        names.push(name)
      }
    }
    return this.reify({
      ...options,
      preferDedupe: true,
      update: { names },
    })
  }
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641885, function(require, module, exports) {
// mixin implementing the audit method

const AuditReport = require('../audit-report.js')

// shared with reify
const _global = Symbol.for('global')
const _workspaces = Symbol.for('workspaces')
const _includeWorkspaceRoot = Symbol.for('includeWorkspaceRoot')

module.exports = cls => class Auditor extends cls {
  async audit (options = {}) {
    this.addTracker('audit')
    if (this[_global]) {
      throw Object.assign(
        new Error('`npm audit` does not support testing globals'),
        { code: 'EAUDITGLOBAL' }
      )
    }

    // allow the user to set options on the ctor as well.
    // XXX: deprecate separate method options objects.
    options = { ...this.options, ...options }

    process.emit('time', 'audit')
    const tree = await this.loadVirtual()
    if (this[_workspaces] && this[_workspaces].length) {
      options.filterSet = this.workspaceDependencySet(
        tree,
        this[_workspaces],
        this[_includeWorkspaceRoot]
      )
    }
    if (!options.workspacesEnabled) {
      options.filterSet =
        this.excludeWorkspacesDependencySet(tree)
    }
    this.auditReport = await AuditReport.load(tree, options)
    const ret = options.fix ? this.reify(options) : this.auditReport
    process.emit('timeEnd', 'audit')
    this.finishTracker('audit')
    return ret
  }
}

}, function(modId) { var map = {"../audit-report.js":1653046641886}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641886, function(require, module, exports) {
// an object representing the set of vulnerabilities in a tree
/* eslint camelcase: "off" */

const localeCompare = require('@isaacs/string-locale-compare')('en')
const npa = require('npm-package-arg')
const pickManifest = require('npm-pick-manifest')

const Vuln = require('./vuln.js')
const Calculator = require('@npmcli/metavuln-calculator')

const _getReport = Symbol('getReport')
const _fixAvailable = Symbol('fixAvailable')
const _checkTopNode = Symbol('checkTopNode')
const _init = Symbol('init')
const _omit = Symbol('omit')
const log = require('proc-log')

const fetch = require('npm-registry-fetch')

class AuditReport extends Map {
  static load (tree, opts) {
    return new AuditReport(tree, opts).run()
  }

  get auditReportVersion () {
    return 2
  }

  toJSON () {
    const obj = {
      auditReportVersion: this.auditReportVersion,
      vulnerabilities: {},
      metadata: {
        vulnerabilities: {
          info: 0,
          low: 0,
          moderate: 0,
          high: 0,
          critical: 0,
          total: this.size,
        },
        dependencies: {
          prod: 0,
          dev: 0,
          optional: 0,
          peer: 0,
          peerOptional: 0,
          total: this.tree.inventory.size - 1,
        },
      },
    }

    for (const node of this.tree.inventory.values()) {
      const { dependencies } = obj.metadata
      let prod = true
      for (const type of [
        'dev',
        'optional',
        'peer',
        'peerOptional',
      ]) {
        if (node[type]) {
          dependencies[type]++
          prod = false
        }
      }
      if (prod) {
        dependencies.prod++
      }
    }

    // if it doesn't have any topVulns, then it's fixable with audit fix
    // for each topVuln, figure out if it's fixable with audit fix --force,
    // or if we have to just delete the thing, and if the fix --force will
    // require a semver major update.
    const vulnerabilities = []
    for (const [name, vuln] of this.entries()) {
      vulnerabilities.push([name, vuln.toJSON()])
      obj.metadata.vulnerabilities[vuln.severity]++
    }

    obj.vulnerabilities = vulnerabilities
      .sort(([a], [b]) => localeCompare(a, b))
      .reduce((set, [name, vuln]) => {
        set[name] = vuln
        return set
      }, {})

    return obj
  }

  constructor (tree, opts = {}) {
    super()
    const { omit } = opts
    this[_omit] = new Set(omit || [])
    this.topVulns = new Map()

    this.calculator = new Calculator(opts)
    this.error = null
    this.options = opts
    this.tree = tree
    this.filterSet = opts.filterSet
  }

  async run () {
    this.report = await this[_getReport]()
    log.silly('audit report', this.report)
    if (this.report) {
      await this[_init]()
    }
    return this
  }

  isVulnerable (node) {
    const vuln = this.get(node.packageName)
    return !!(vuln && vuln.isVulnerable(node))
  }

  async [_init] () {
    process.emit('time', 'auditReport:init')

    const promises = []
    for (const [name, advisories] of Object.entries(this.report)) {
      for (const advisory of advisories) {
        promises.push(this.calculator.calculate(name, advisory))
      }
    }

    // now the advisories are calculated with a set of versions
    // and the packument.  turn them into our style of vuln objects
    // which also have the affected nodes, and also create entries
    // for all the metavulns that we find from dependents.
    const advisories = new Set(await Promise.all(promises))
    const seen = new Set()
    for (const advisory of advisories) {
      const { name, range } = advisory

      // don't flag the exact same name/range more than once
      // adding multiple advisories with the same range is fine, but no
      // need to search for nodes we already would have added.
      const k = `${name}@${range}`
      if (seen.has(k)) {
        continue
      }

      seen.add(k)

      const vuln = this.get(name) || new Vuln({ name, advisory })
      if (this.has(name)) {
        vuln.addAdvisory(advisory)
      }
      super.set(name, vuln)

      const p = []
      for (const node of this.tree.inventory.query('packageName', name)) {
        if (!shouldAudit(node, this[_omit], this.filterSet)) {
          continue
        }

        // if not vulnerable by this advisory, keep searching
        if (!advisory.testVersion(node.version)) {
          continue
        }

        // we will have loaded the source already if this is a metavuln
        if (advisory.type === 'metavuln') {
          vuln.addVia(this.get(advisory.dependency))
        }

        // already marked this one, no need to do it again
        if (vuln.nodes.has(node)) {
          continue
        }

        // haven't marked this one yet.  get its dependents.
        vuln.nodes.add(node)
        for (const { from: dep, spec } of node.edgesIn) {
          if (dep.isTop && !vuln.topNodes.has(dep)) {
            this[_checkTopNode](dep, vuln, spec)
          } else {
            // calculate a metavuln, if necessary
            const calc = this.calculator.calculate(dep.packageName, advisory)
            p.push(calc.then(meta => {
              if (meta.testVersion(dep.version, spec)) {
                advisories.add(meta)
              }
            }))
          }
        }
      }
      await Promise.all(p)

      // make sure we actually got something.  if not, remove it
      // this can happen if you are loading from a lockfile created by
      // npm v5, since it lists the current version of all deps,
      // rather than the range that is actually depended upon,
      // or if using --omit with the older audit endpoint.
      if (this.get(name).nodes.size === 0) {
        this.delete(name)
        continue
      }

      // if the vuln is valid, but THIS advisory doesn't apply to any of
      // the nodes it references, then remove it from the advisory list.
      // happens when using omit with old audit endpoint.
      for (const advisory of vuln.advisories) {
        const relevant = [...vuln.nodes]
          .some(n => advisory.testVersion(n.version))
        if (!relevant) {
          vuln.deleteAdvisory(advisory)
        }
      }
    }
    process.emit('timeEnd', 'auditReport:init')
  }

  [_checkTopNode] (topNode, vuln, spec) {
    vuln.fixAvailable = this[_fixAvailable](topNode, vuln, spec)

    if (vuln.fixAvailable !== true) {
      // now we know the top node is vulnerable, and cannot be
      // upgraded out of the bad place without --force.  But, there's
      // no need to add it to the actual vulns list, because nothing
      // depends on root.
      this.topVulns.set(vuln.name, vuln)
      vuln.topNodes.add(topNode)
    }
  }

  // check whether the top node is vulnerable.
  // check whether we can get out of the bad place with --force, and if
  // so, whether that update is SemVer Major
  [_fixAvailable] (topNode, vuln, spec) {
    // this will always be set to at least {name, versions:{}}
    const paku = vuln.packument

    if (!vuln.testSpec(spec)) {
      return true
    }

    // similarly, even if we HAVE a packument, but we're looking for it
    // somewhere other than the registry, and we got something vulnerable,
    // then we're stuck with it.
    const specObj = npa(spec)
    if (!specObj.registry) {
      return false
    }

    if (specObj.subSpec) {
      spec = specObj.subSpec.rawSpec
    }

    // We don't provide fixes for top nodes other than root, but we
    // still check to see if the node is fixable with a different version,
    // and if that is a semver major bump.
    try {
      const {
        _isSemVerMajor: isSemVerMajor,
        version,
        name,
      } = pickManifest(paku, spec, {
        ...this.options,
        before: null,
        avoid: vuln.range,
        avoidStrict: true,
      })
      return { name, version, isSemVerMajor }
    } catch (er) {
      return false
    }
  }

  set () {
    throw new Error('do not call AuditReport.set() directly')
  }

  // convert a quick-audit into a bulk advisory listing
  static auditToBulk (report) {
    if (!report.advisories) {
      // tack on the report json where the response body would go
      throw Object.assign(new Error('Invalid advisory report'), {
        body: JSON.stringify(report),
      })
    }

    const bulk = {}
    const { advisories } = report
    for (const advisory of Object.values(advisories)) {
      const {
        id,
        url,
        title,
        severity = 'high',
        vulnerable_versions = '*',
        module_name: name,
      } = advisory
      bulk[name] = bulk[name] || []
      bulk[name].push({ id, url, title, severity, vulnerable_versions })
    }

    return bulk
  }

  async [_getReport] () {
    // if we're not auditing, just return false
    if (this.options.audit === false || this.options.offline === true || this.tree.inventory.size === 1) {
      return null
    }

    process.emit('time', 'auditReport:getReport')
    try {
      try {
        // first try the super fast bulk advisory listing
        const body = prepareBulkData(this.tree, this[_omit], this.filterSet)
        log.silly('audit', 'bulk request', body)

        // no sense asking if we don't have anything to audit,
        // we know it'll be empty
        if (!Object.keys(body).length) {
          return null
        }

        const res = await fetch('/-/npm/v1/security/advisories/bulk', {
          ...this.options,
          registry: this.options.auditRegistry || this.options.registry,
          method: 'POST',
          gzip: true,
          body,
        })

        return await res.json()
      } catch (er) {
        log.silly('audit', 'bulk request failed', String(er.body))
        // that failed, try the quick audit endpoint
        const body = prepareData(this.tree, this.options)
        const res = await fetch('/-/npm/v1/security/audits/quick', {
          ...this.options,
          registry: this.options.auditRegistry || this.options.registry,
          method: 'POST',
          gzip: true,
          body,
        })
        return AuditReport.auditToBulk(await res.json())
      }
    } catch (er) {
      log.verbose('audit error', er)
      log.silly('audit error', String(er.body))
      this.error = er
      return null
    } finally {
      process.emit('timeEnd', 'auditReport:getReport')
    }
  }
}

// return true if we should audit this one
const shouldAudit = (node, omit, filterSet) =>
  !node.version ? false
  : node.isRoot ? false
  : filterSet && filterSet.size !== 0 && !filterSet.has(node) ? false
  : omit.size === 0 ? true
  : !( // otherwise, just ensure we're not omitting this one
    node.dev && omit.has('dev') ||
    node.optional && omit.has('optional') ||
    node.devOptional && omit.has('dev') && omit.has('optional') ||
    node.peer && omit.has('peer')
  )

const prepareBulkData = (tree, omit, filterSet) => {
  const payload = {}
  for (const name of tree.inventory.query('packageName')) {
    const set = new Set()
    for (const node of tree.inventory.query('packageName', name)) {
      if (!shouldAudit(node, omit, filterSet)) {
        continue
      }

      set.add(node.version)
    }
    if (set.size) {
      payload[name] = [...set]
    }
  }
  return payload
}

const prepareData = (tree, opts) => {
  const { npmVersion: npm_version } = opts
  const node_version = process.version
  const { platform, arch } = process
  const { NODE_ENV: node_env } = process.env
  const data = tree.meta.commit()
  // the legacy audit endpoint doesn't support any kind of pre-filtering
  // we just have to get the advisories and skip over them in the report
  return {
    name: data.name,
    version: data.version,
    requires: {
      ...(tree.package.devDependencies || {}),
      ...(tree.package.peerDependencies || {}),
      ...(tree.package.optionalDependencies || {}),
      ...(tree.package.dependencies || {}),
    },
    dependencies: data.dependencies,
    metadata: {
      node_version,
      npm_version,
      platform,
      arch,
      node_env,
    },
  }
}

module.exports = AuditReport

}, function(modId) { var map = {"./vuln.js":1653046641887}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641887, function(require, module, exports) {
// An object representing a vulnerability either as the result of an
// advisory or due to the package in question depending exclusively on
// vulnerable versions of a dep.
//
// - name: package name
// - range: Set of vulnerable versions
// - nodes: Set of nodes affected
// - effects: Set of vulns triggered by this one
// - advisories: Set of advisories (including metavulns) causing this vuln.
//   All of the entries in via are vulnerability objects returned by
//   @npmcli/metavuln-calculator
// - via: dependency vulns which cause this one

const { satisfies, simplifyRange } = require('semver')
const semverOpt = { loose: true, includePrerelease: true }

const localeCompare = require('@isaacs/string-locale-compare')('en')
const npa = require('npm-package-arg')
const _range = Symbol('_range')
const _simpleRange = Symbol('_simpleRange')
const _fixAvailable = Symbol('_fixAvailable')

const severities = new Map([
  ['info', 0],
  ['low', 1],
  ['moderate', 2],
  ['high', 3],
  ['critical', 4],
  [null, -1],
])

for (const [name, val] of severities.entries()) {
  severities.set(val, name)
}

class Vuln {
  constructor ({ name, advisory }) {
    this.name = name
    this.via = new Set()
    this.advisories = new Set()
    this.severity = null
    this.effects = new Set()
    this.topNodes = new Set()
    this[_range] = null
    this[_simpleRange] = null
    this.nodes = new Set()
    // assume a fix is available unless it hits a top node
    // that locks it in place, setting this false or {isSemVerMajor, version}.
    this[_fixAvailable] = true
    this.addAdvisory(advisory)
    this.packument = advisory.packument
    this.versions = advisory.versions
  }

  get fixAvailable () {
    return this[_fixAvailable]
  }

  set fixAvailable (f) {
    this[_fixAvailable] = f
    // if there's a fix available for this at the top level, it means that
    // it will also fix the vulns that led to it being there.  to get there,
    // we set the vias to the most "strict" of fix availables.
    // - false: no fix is available
    // - {name, version, isSemVerMajor} fix requires -f, is semver major
    // - {name, version} fix requires -f, not semver major
    // - true: fix does not require -f
    for (const v of this.via) {
      // don't blow up on loops
      if (v.fixAvailable === f) {
        continue
      }

      if (f === false) {
        v.fixAvailable = f
      } else if (v.fixAvailable === true) {
        v.fixAvailable = f
      } else if (typeof f === 'object' && (
        typeof v.fixAvailable !== 'object' || !v.fixAvailable.isSemVerMajor)) {
        v.fixAvailable = f
      }
    }
  }

  get isDirect () {
    for (const node of this.nodes.values()) {
      for (const edge of node.edgesIn) {
        if (edge.from.isProjectRoot || edge.from.isWorkspace) {
          return true
        }
      }
    }
    return false
  }

  testSpec (spec) {
    const specObj = npa(spec)
    if (!specObj.registry) {
      return true
    }

    if (specObj.subSpec) {
      spec = specObj.subSpec.rawSpec
    }

    for (const v of this.versions) {
      if (satisfies(v, spec) && !satisfies(v, this.range, semverOpt)) {
        return false
      }
    }
    return true
  }

  toJSON () {
    return {
      name: this.name,
      severity: this.severity,
      isDirect: this.isDirect,
      // just loop over the advisories, since via is only Vuln objects,
      // and calculated advisories have all the info we need
      via: [...this.advisories].map(v => v.type === 'metavuln' ? v.dependency : {
        ...v,
        versions: undefined,
        vulnerableVersions: undefined,
        id: undefined,
      }).sort((a, b) =>
        localeCompare(String(a.source || a), String(b.source || b))),
      effects: [...this.effects].map(v => v.name).sort(localeCompare),
      range: this.simpleRange,
      nodes: [...this.nodes].map(n => n.location).sort(localeCompare),
      fixAvailable: this[_fixAvailable],
    }
  }

  addVia (v) {
    this.via.add(v)
    v.effects.add(this)
    // call the setter since we might add vias _after_ setting fixAvailable
    this.fixAvailable = this.fixAvailable
  }

  deleteVia (v) {
    this.via.delete(v)
    v.effects.delete(this)
  }

  deleteAdvisory (advisory) {
    this.advisories.delete(advisory)
    // make sure we have the max severity of all the vulns causing this one
    this.severity = null
    this[_range] = null
    this[_simpleRange] = null
    // refresh severity
    for (const advisory of this.advisories) {
      this.addAdvisory(advisory)
    }

    // remove any effects that are no longer relevant
    const vias = new Set([...this.advisories].map(a => a.dependency))
    for (const via of this.via) {
      if (!vias.has(via.name)) {
        this.deleteVia(via)
      }
    }
  }

  addAdvisory (advisory) {
    this.advisories.add(advisory)
    const sev = severities.get(advisory.severity)
    this[_range] = null
    this[_simpleRange] = null
    if (sev > severities.get(this.severity)) {
      this.severity = advisory.severity
    }
  }

  get range () {
    return this[_range] ||
      (this[_range] = [...this.advisories].map(v => v.range).join(' || '))
  }

  get simpleRange () {
    if (this[_simpleRange] && this[_simpleRange] === this[_range]) {
      return this[_simpleRange]
    }

    const versions = [...this.advisories][0].versions
    const range = this.range
    const simple = simplifyRange(versions, range, semverOpt)
    return this[_simpleRange] = this[_range] = simple
  }

  isVulnerable (node) {
    if (this.nodes.has(node)) {
      return true
    }

    const { version } = node.package
    if (!version) {
      return false
    }

    for (const v of this.advisories) {
      if (v.testVersion(version)) {
        this.nodes.add(node)
        return true
      }
    }

    return false
  }
}

module.exports = Vuln

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641888, function(require, module, exports) {
// mixin implementing the buildIdealTree method
const localeCompare = require('@isaacs/string-locale-compare')('en')
const rpj = require('read-package-json-fast')
const npa = require('npm-package-arg')
const pacote = require('pacote')
const cacache = require('cacache')
const promiseCallLimit = require('promise-call-limit')
const realpath = require('../../lib/realpath.js')
const { resolve, dirname } = require('path')
const { promisify } = require('util')
const treeCheck = require('../tree-check.js')
const readdir = promisify(require('readdir-scoped-modules'))
const fs = require('fs')
const lstat = promisify(fs.lstat)
const readlink = promisify(fs.readlink)
const { depth } = require('treeverse')
const log = require('proc-log')

const {
  OK,
  REPLACE,
  CONFLICT,
} = require('../can-place-dep.js')
const PlaceDep = require('../place-dep.js')

const debug = require('../debug.js')
const fromPath = require('../from-path.js')
const calcDepFlags = require('../calc-dep-flags.js')
const Shrinkwrap = require('../shrinkwrap.js')
const { defaultLockfileVersion } = Shrinkwrap
const Node = require('../node.js')
const Link = require('../link.js')
const addRmPkgDeps = require('../add-rm-pkg-deps.js')
const optionalSet = require('../optional-set.js')
const { checkEngine, checkPlatform } = require('npm-install-checks')

const relpath = require('../relpath.js')

// note: some of these symbols are shared so we can hit
// them with unit tests and reuse them across mixins
const _complete = Symbol('complete')
const _depsSeen = Symbol('depsSeen')
const _depsQueue = Symbol('depsQueue')
const _currentDep = Symbol('currentDep')
const _updateAll = Symbol.for('updateAll')
const _mutateTree = Symbol('mutateTree')
const _flagsSuspect = Symbol.for('flagsSuspect')
const _workspaces = Symbol.for('workspaces')
const _prune = Symbol('prune')
const _preferDedupe = Symbol('preferDedupe')
const _legacyBundling = Symbol('legacyBundling')
const _parseSettings = Symbol('parseSettings')
const _initTree = Symbol('initTree')
const _applyUserRequests = Symbol('applyUserRequests')
const _applyUserRequestsToNode = Symbol('applyUserRequestsToNode')
const _inflateAncientLockfile = Symbol('inflateAncientLockfile')
const _buildDeps = Symbol('buildDeps')
const _buildDepStep = Symbol('buildDepStep')
const _nodeFromEdge = Symbol('nodeFromEdge')
const _nodeFromSpec = Symbol('nodeFromSpec')
const _fetchManifest = Symbol('fetchManifest')
const _problemEdges = Symbol('problemEdges')
const _manifests = Symbol('manifests')
const _loadWorkspaces = Symbol.for('loadWorkspaces')
const _linkFromSpec = Symbol('linkFromSpec')
const _loadPeerSet = Symbol('loadPeerSet')
const _updateNames = Symbol.for('updateNames')
const _fixDepFlags = Symbol('fixDepFlags')
const _resolveLinks = Symbol('resolveLinks')
const _rootNodeFromPackage = Symbol('rootNodeFromPackage')
const _add = Symbol('add')
const _resolvedAdd = Symbol.for('resolvedAdd')
const _queueNamedUpdates = Symbol('queueNamedUpdates')
const _queueVulnDependents = Symbol('queueVulnDependents')
const _avoidRange = Symbol('avoidRange')
const _shouldUpdateNode = Symbol('shouldUpdateNode')
const resetDepFlags = require('../reset-dep-flags.js')
const _loadFailures = Symbol('loadFailures')
const _pruneFailedOptional = Symbol('pruneFailedOptional')
const _linkNodes = Symbol('linkNodes')
const _follow = Symbol('follow')
const _globalStyle = Symbol('globalStyle')
const _globalRootNode = Symbol('globalRootNode')
const _isVulnerable = Symbol.for('isVulnerable')
const _usePackageLock = Symbol.for('usePackageLock')
const _rpcache = Symbol.for('realpathCache')
const _stcache = Symbol.for('statCache')
const _updateFilePath = Symbol('updateFilePath')
const _followSymlinkPath = Symbol('followSymlinkPath')
const _getRelpathSpec = Symbol('getRelpathSpec')
const _retrieveSpecName = Symbol('retrieveSpecName')
const _strictPeerDeps = Symbol('strictPeerDeps')
const _checkEngineAndPlatform = Symbol('checkEngineAndPlatform')
const _checkEngine = Symbol('checkEngine')
const _checkPlatform = Symbol('checkPlatform')
const _virtualRoots = Symbol('virtualRoots')
const _virtualRoot = Symbol('virtualRoot')
const _includeWorkspaceRoot = Symbol.for('includeWorkspaceRoot')

const _failPeerConflict = Symbol('failPeerConflict')
const _explainPeerConflict = Symbol('explainPeerConflict')
const _edgesOverridden = Symbol('edgesOverridden')
// exposed symbol for unit testing the placeDep method directly
const _peerSetSource = Symbol.for('peerSetSource')

// used by Reify mixin
const _force = Symbol.for('force')
const _explicitRequests = Symbol('explicitRequests')
const _global = Symbol.for('global')
const _idealTreePrune = Symbol.for('idealTreePrune')

module.exports = cls => class IdealTreeBuilder extends cls {
  constructor (options) {
    super(options)

    // normalize trailing slash
    const registry = options.registry || 'https://registry.npmjs.org'
    options.registry = this.registry = registry.replace(/\/+$/, '') + '/'

    const {
      follow = false,
      force = false,
      global = false,
      globalStyle = false,
      idealTree = null,
      includeWorkspaceRoot = false,
      legacyPeerDeps = false,
      packageLock = true,
      strictPeerDeps = false,
      workspaces = [],
    } = options

    this[_workspaces] = workspaces || []
    this[_force] = !!force
    this[_strictPeerDeps] = !!strictPeerDeps

    this.idealTree = idealTree
    this.legacyPeerDeps = legacyPeerDeps

    this[_usePackageLock] = packageLock
    this[_global] = !!global
    this[_globalStyle] = this[_global] || globalStyle
    this[_follow] = !!follow

    if (this[_workspaces].length && this[_global]) {
      throw new Error('Cannot operate on workspaces in global mode')
    }

    this[_explicitRequests] = new Set()
    this[_preferDedupe] = false
    this[_legacyBundling] = false
    this[_depsSeen] = new Set()
    this[_depsQueue] = []
    this[_currentDep] = null
    this[_updateNames] = []
    this[_updateAll] = false
    this[_mutateTree] = false
    this[_loadFailures] = new Set()
    this[_linkNodes] = new Set()
    this[_manifests] = new Map()
    this[_edgesOverridden] = new Set()
    this[_resolvedAdd] = []

    // a map of each module in a peer set to the thing that depended on
    // that set of peers in the first place.  Use a WeakMap so that we
    // don't hold onto references for nodes that are garbage collected.
    this[_peerSetSource] = new WeakMap()
    this[_virtualRoots] = new Map()

    this[_includeWorkspaceRoot] = includeWorkspaceRoot
  }

  get explicitRequests () {
    return new Set(this[_explicitRequests])
  }

  // public method
  async buildIdealTree (options = {}) {
    if (this.idealTree) {
      return this.idealTree
    }

    // allow the user to set reify options on the ctor as well.
    // XXX: deprecate separate reify() options object.
    options = { ...this.options, ...options }

    // an empty array or any falsey value is the same as null
    if (!options.add || options.add.length === 0) {
      options.add = null
    }
    if (!options.rm || options.rm.length === 0) {
      options.rm = null
    }

    process.emit('time', 'idealTree')

    if (!options.add && !options.rm && !options.update && this[_global]) {
      throw new Error('global requires add, rm, or update option')
    }

    // first get the virtual tree, if possible.  If there's a lockfile, then
    // that defines the ideal tree, unless the root package.json is not
    // satisfied by what the ideal tree provides.
    // from there, we start adding nodes to it to satisfy the deps requested
    // by the package.json in the root.

    this[_parseSettings](options)

    // start tracker block
    this.addTracker('idealTree')

    try {
      await this[_initTree]()
      await this[_inflateAncientLockfile]()
      await this[_applyUserRequests](options)
      await this[_buildDeps]()
      await this[_fixDepFlags]()
      await this[_pruneFailedOptional]()
      await this[_checkEngineAndPlatform]()
    } finally {
      process.emit('timeEnd', 'idealTree')
      this.finishTracker('idealTree')
    }

    return treeCheck(this.idealTree)
  }

  async [_checkEngineAndPlatform] () {
    for (const node of this.idealTree.inventory.values()) {
      if (!node.optional) {
        this[_checkEngine](node)
        this[_checkPlatform](node)
      }
    }
  }

  [_checkPlatform] (node) {
    checkPlatform(node.package, this[_force])
  }

  [_checkEngine] (node) {
    const { engineStrict, npmVersion, nodeVersion } = this.options
    const c = () =>
      checkEngine(node.package, npmVersion, nodeVersion, this[_force])

    if (engineStrict) {
      c()
    } else {
      try {
        c()
      } catch (er) {
        log.warn(er.code, er.message, {
          package: er.pkgid,
          required: er.required,
          current: er.current,
        })
      }
    }
  }

  [_parseSettings] (options) {
    const update = options.update === true ? { all: true }
      : Array.isArray(options.update) ? { names: options.update }
      : options.update || {}

    if (update.all || !Array.isArray(update.names)) {
      update.names = []
    }

    this[_complete] = !!options.complete
    this[_preferDedupe] = !!options.preferDedupe
    this[_legacyBundling] = !!options.legacyBundling

    // validates list of update names, they must
    // be dep names only, no semver ranges are supported
    for (const name of update.names) {
      const spec = npa(name)
      const validationError =
        new TypeError(`Update arguments must not contain package version specifiers

Try using the package name instead, e.g:
    npm update ${spec.name}`)
      validationError.code = 'EUPDATEARGS'

      if (spec.fetchSpec !== 'latest') {
        throw validationError
      }
    }
    this[_updateNames] = update.names

    this[_updateAll] = update.all
    // we prune by default unless explicitly set to boolean false
    this[_prune] = options.prune !== false

    // set if we add anything, but also set here if we know we'll make
    // changes and thus have to maybe prune later.
    this[_mutateTree] = !!(
      options.add ||
      options.rm ||
      update.all ||
      update.names.length
    )
  }

  // load the initial tree, either the virtualTree from a shrinkwrap,
  // or just the root node from a package.json
  [_initTree] () {
    process.emit('time', 'idealTree:init')
    return (
      this[_global] ? this[_globalRootNode]()
      : rpj(this.path + '/package.json').then(
        pkg => this[_rootNodeFromPackage](pkg),
        er => {
          if (er.code === 'EJSONPARSE') {
            throw er
          }
          return this[_rootNodeFromPackage]({})
        }
      ))
      .then(root => this[_loadWorkspaces](root))
      // ok to not have a virtual tree.  probably initial install.
      // When updating all, we load the shrinkwrap, but don't bother
      // to build out the full virtual tree from it, since we'll be
      // reconstructing it anyway.
      .then(root => this[_global] ? root
      : !this[_usePackageLock] || this[_updateAll]
        ? Shrinkwrap.reset({
          path: this.path,
          lockfileVersion: this.options.lockfileVersion,
        }).then(meta => Object.assign(root, { meta }))
        : this.loadVirtual({ root }))

      // if we don't have a lockfile to go from, then start with the
      // actual tree, so we only make the minimum required changes.
      // don't do this for global installs or updates, because in those
      // cases we don't use a lockfile anyway.
      // Load on a new Arborist object, so the Nodes aren't the same,
      // or else it'll get super confusing when we change them!
      .then(async root => {
        if ((!this[_updateAll] && !this[_global] && !root.meta.loadedFromDisk) || (this[_global] && this[_updateNames].length)) {
          await new this.constructor(this.options).loadActual({ root })
          const tree = root.target
          // even though we didn't load it from a package-lock.json FILE,
          // we still loaded it "from disk", meaning we have to reset
          // dep flags before assuming that any mutations were reflected.
          if (tree.children.size) {
            root.meta.loadedFromDisk = true
            // set these so that we don't try to ancient lockfile reload it
            root.meta.originalLockfileVersion = defaultLockfileVersion
            root.meta.lockfileVersion = defaultLockfileVersion
          }
        }
        root.meta.inferFormattingOptions(root.package)
        return root
      })

      .then(tree => {
        // null the virtual tree, because we're about to hack away at it
        // if you want another one, load another copy.
        this.idealTree = tree
        this.virtualTree = null
        process.emit('timeEnd', 'idealTree:init')
      })
  }

  async [_globalRootNode] () {
    const root = await this[_rootNodeFromPackage]({ dependencies: {} })
    // this is a gross kludge to handle the fact that we don't save
    // metadata on the root node in global installs, because the "root"
    // node is something like /usr/local/lib.
    const meta = new Shrinkwrap({
      path: this.path,
      lockfileVersion: this.options.lockfileVersion,
    })
    meta.reset()
    root.meta = meta
    return root
  }

  async [_rootNodeFromPackage] (pkg) {
    // if the path doesn't exist, then we explode at this point. Note that
    // this is not a problem for reify(), since it creates the root path
    // before ever loading trees.
    // TODO: make buildIdealTree() and loadActual handle a missing root path,
    // or a symlink to a missing target, and let reify() create it as needed.
    const real = await realpath(this.path, this[_rpcache], this[_stcache])
    const Cls = real === this.path ? Node : Link
    const root = new Cls({
      path: this.path,
      realpath: real,
      pkg,
      extraneous: false,
      dev: false,
      devOptional: false,
      peer: false,
      optional: false,
      global: this[_global],
      legacyPeerDeps: this.legacyPeerDeps,
      loadOverrides: true,
    })
    if (root.isLink) {
      root.target = new Node({
        path: real,
        realpath: real,
        pkg,
        extraneous: false,
        dev: false,
        devOptional: false,
        peer: false,
        optional: false,
        global: this[_global],
        legacyPeerDeps: this.legacyPeerDeps,
        root,
      })
    }
    return root
  }

  // process the add/rm requests by modifying the root node, and the
  // update.names request by queueing nodes dependent on those named.
  async [_applyUserRequests] (options) {
    process.emit('time', 'idealTree:userRequests')
    const tree = this.idealTree.target

    if (!this[_workspaces].length) {
      await this[_applyUserRequestsToNode](tree, options)
    } else {
      const nodes = this.workspaceNodes(tree, this[_workspaces])
      if (this[_includeWorkspaceRoot]) {
        nodes.push(tree)
      }
      const appliedRequests = nodes.map(
        node => this[_applyUserRequestsToNode](node, options)
      )
      await Promise.all(appliedRequests)
    }

    process.emit('timeEnd', 'idealTree:userRequests')
  }

  async [_applyUserRequestsToNode] (tree, options) {
    // If we have a list of package names to update, and we know it's
    // going to update them wherever they are, add any paths into those
    // named nodes to the buildIdealTree queue.
    if (!this[_global] && this[_updateNames].length) {
      this[_queueNamedUpdates]()
    }

    // global updates only update the globalTop nodes, but we need to know
    // that they're there, and not reinstall the world unnecessarily.
    const globalExplicitUpdateNames = []
    if (this[_global] && (this[_updateAll] || this[_updateNames].length)) {
      const nm = resolve(this.path, 'node_modules')
      for (const name of await readdir(nm).catch(() => [])) {
        tree.package.dependencies = tree.package.dependencies || {}
        const updateName = this[_updateNames].includes(name)
        if (this[_updateAll] || updateName) {
          if (updateName) {
            globalExplicitUpdateNames.push(name)
          }
          const dir = resolve(nm, name)
          const st = await lstat(dir)
            .catch(/* istanbul ignore next */ er => null)
          if (st && st.isSymbolicLink()) {
            const target = await readlink(dir)
            const real = resolve(dirname(dir), target)
            tree.package.dependencies[name] = `file:${real}`
          } else {
            tree.package.dependencies[name] = '*'
          }
        }
      }
    }

    if (this.auditReport && this.auditReport.size > 0) {
      await this[_queueVulnDependents](options)
    }

    const { add, rm } = options

    if (rm && rm.length) {
      addRmPkgDeps.rm(tree.package, rm)
      for (const name of rm) {
        this[_explicitRequests].add({ from: tree, name, action: 'DELETE' })
      }
    }

    if (add && add.length) {
      await this[_add](tree, options)
    }

    // triggers a refresh of all edgesOut.  this has to be done BEFORE
    // adding the edges to explicitRequests, because the package setter
    // resets all edgesOut.
    if (add && add.length || rm && rm.length || this[_global]) {
      tree.package = tree.package
    }

    for (const spec of this[_resolvedAdd]) {
      if (spec.tree === tree) {
        this[_explicitRequests].add(tree.edgesOut.get(spec.name))
      }
    }
    for (const name of globalExplicitUpdateNames) {
      this[_explicitRequests].add(tree.edgesOut.get(name))
    }

    this[_depsQueue].push(tree)
  }

  // This returns a promise because we might not have the name yet,
  // and need to call pacote.manifest to find the name.
  [_add] (tree, { add, saveType = null, saveBundle = false }) {
    // get the name for each of the specs in the list.
    // ie, doing `foo@bar` we just return foo
    // but if it's a url or git, we don't know the name until we
    // fetch it and look in its manifest.
    return Promise.all(add.map(async rawSpec => {
      // We do NOT provide the path to npa here, because user-additions
      // need to be resolved relative to the CWD the user is in.
      const spec = await this[_retrieveSpecName](npa(rawSpec))
        .then(spec => this[_updateFilePath](spec))
        .then(spec => this[_followSymlinkPath](spec))
      spec.tree = tree
      return spec
    })).then(add => {
      this[_resolvedAdd].push(...add)
      // now add is a list of spec objects with names.
      // find a home for each of them!
      addRmPkgDeps.add({
        pkg: tree.package,
        add,
        saveBundle,
        saveType,
        path: this.path,
      })
    })
  }

  async [_retrieveSpecName] (spec) {
    // if it's just @'' then we reload whatever's there, or get latest
    // if it's an explicit tag, we need to install that specific tag version
    const isTag = spec.rawSpec && spec.type === 'tag'

    if (spec.name && !isTag) {
      return spec
    }

    const mani = await pacote.manifest(spec, { ...this.options })
    // if it's a tag type, then we need to run it down to an actual version
    if (isTag) {
      return npa(`${mani.name}@${mani.version}`)
    }

    spec.name = mani.name
    return spec
  }

  async [_updateFilePath] (spec) {
    if (spec.type === 'file') {
      return this[_getRelpathSpec](spec, spec.fetchSpec)
    }

    return spec
  }

  async [_followSymlinkPath] (spec) {
    if (spec.type === 'directory') {
      const real = await (
        realpath(spec.fetchSpec, this[_rpcache], this[_stcache])
          // TODO: create synthetic test case to simulate realpath failure
          .catch(/* istanbul ignore next */() => null)
      )

      return this[_getRelpathSpec](spec, real)
    }
    return spec
  }

  [_getRelpathSpec] (spec, filepath) {
    /* istanbul ignore else - should also be covered by realpath failure */
    if (filepath) {
      const { name } = spec
      const tree = this.idealTree.target
      spec = npa(`file:${relpath(tree.path, filepath)}`, tree.path)
      spec.name = name
    }
    return spec
  }

  // TODO: provide a way to fix bundled deps by exposing metadata about
  // what's in the bundle at each published manifest.  Without that, we
  // can't possibly fix bundled deps without breaking a ton of other stuff,
  // and leaving the user subject to getting it overwritten later anyway.
  async [_queueVulnDependents] (options) {
    for (const vuln of this.auditReport.values()) {
      for (const node of vuln.nodes) {
        const bundler = node.getBundler()

        // XXX this belongs in the audit report itself, not here.
        // We shouldn't even get these things here, and they shouldn't
        // be printed by npm-audit-report as if they can be fixed, because
        // they can't.
        if (bundler) {
          log.warn(`audit fix ${node.name}@${node.version}`,
            `${node.location}\nis a bundled dependency of\n${
            bundler.name}@${bundler.version} at ${bundler.location}\n` +
            'It cannot be fixed automatically.\n' +
            `Check for updates to the ${bundler.name} package.`)
          continue
        }

        for (const edge of node.edgesIn) {
          this.addTracker('idealTree', edge.from.name, edge.from.location)
          this[_depsQueue].push(edge.from)
        }
      }
    }

    // note any that can't be fixed at the root level without --force
    // if there's a fix, we use that.  otherwise, the user has to remove it,
    // find a different thing, fix the upstream, etc.
    //
    // XXX: how to handle top nodes that aren't the root?  Maybe the report
    // just tells the user to cd into that directory and fix it?
    if (this[_force] && this.auditReport && this.auditReport.topVulns.size) {
      options.add = options.add || []
      options.rm = options.rm || []
      const nodesTouched = new Set()
      for (const [name, topVuln] of this.auditReport.topVulns.entries()) {
        const {
          simpleRange,
          topNodes,
          fixAvailable,
        } = topVuln
        for (const node of topNodes) {
          if (!node.isProjectRoot && !node.isWorkspace) {
            // not something we're going to fix, sorry.  have to cd into
            // that directory and fix it yourself.
            log.warn('audit', 'Manual fix required in linked project ' +
              `at ./${node.location} for ${name}@${simpleRange}.\n` +
              `'cd ./${node.location}' and run 'npm audit' for details.`)
            continue
          }

          if (!fixAvailable) {
            log.warn('audit', `No fix available for ${name}@${simpleRange}`)
            continue
          }

          const { isSemVerMajor, version } = fixAvailable
          const breakingMessage = isSemVerMajor
            ? 'a SemVer major change'
            : 'outside your stated dependency range'
          log.warn('audit', `Updating ${name} to ${version},` +
            `which is ${breakingMessage}.`)

          await this[_add](node, { add: [`${name}@${version}`] })
          nodesTouched.add(node)
        }
      }
      for (const node of nodesTouched) {
        node.package = node.package
      }
    }
  }

  [_isVulnerable] (node) {
    return this.auditReport && this.auditReport.isVulnerable(node)
  }

  [_avoidRange] (name) {
    if (!this.auditReport) {
      return null
    }
    const vuln = this.auditReport.get(name)
    if (!vuln) {
      return null
    }
    return vuln.range
  }

  [_queueNamedUpdates] () {
    // ignore top nodes, since they are not loaded the same way, and
    // probably have their own project associated with them.

    // for every node with one of the names on the list, we add its
    // dependents to the queue to be evaluated.  in buildDepStep,
    // anything on the update names list will get refreshed, even if
    // it isn't a problem.

    // XXX this could be faster by doing a series of inventory.query('name')
    // calls rather than walking over everything in the tree.
    const set = this.idealTree.inventory
      .filter(n => this[_shouldUpdateNode](n))
    // XXX add any invalid edgesOut to the queue
    for (const node of set) {
      for (const edge of node.edgesIn) {
        this.addTracker('idealTree', edge.from.name, edge.from.location)
        this[_depsQueue].push(edge.from)
      }
    }
  }

  [_shouldUpdateNode] (node) {
    return this[_updateNames].includes(node.name) &&
      !node.isTop &&
      !node.inDepBundle &&
      !node.inShrinkwrap
  }

  async [_inflateAncientLockfile] () {
    const { meta, inventory } = this.idealTree
    const ancient = meta.ancientLockfile
    const old = meta.loadedFromDisk && !(meta.originalLockfileVersion >= 2)

    if (inventory.size === 0 || !ancient && !old) {
      return
    }

    // if the lockfile is from node v5 or earlier, then we'll have to reload
    // all the manifests of everything we encounter.  this is costly, but at
    // least it's just a one-time hit.
    process.emit('time', 'idealTree:inflate')

    // don't warn if we're not gonna actually write it back anyway.
    const heading = ancient ? 'ancient lockfile' : 'old lockfile'
    if (ancient || !this.options.lockfileVersion ||
        this.options.lockfileVersion >= defaultLockfileVersion) {
      log.warn(heading,
        `
The ${meta.type} file was created with an old version of npm,
so supplemental metadata must be fetched from the registry.

This is a one-time fix-up, please be patient...
`)
    }

    this.addTracker('idealTree:inflate')
    const queue = []
    for (const node of inventory.values()) {
      if (node.isProjectRoot) {
        continue
      }

      queue.push(async () => {
        log.silly('inflate', node.location)
        const { resolved, version, path, name, location, integrity } = node
        // don't try to hit the registry for linked deps
        const useResolved = resolved && (
          !version || resolved.startsWith('file:')
        )
        const id = useResolved ? resolved
          : version || `file:${node.path}`
        const spec = npa.resolve(name, id, dirname(path))
        const t = `idealTree:inflate:${location}`
        this.addTracker(t)
        await pacote.manifest(spec, {
          ...this.options,
          resolved: resolved,
          integrity: integrity,
          fullMetadata: false,
        }).then(mani => {
          node.package = { ...mani, _id: `${mani.name}@${mani.version}` }
        }).catch((er) => {
          const warning = `Could not fetch metadata for ${name}@${id}`
          log.warn(heading, warning, er)
        })
        this.finishTracker(t)
      })
    }
    await promiseCallLimit(queue)

    // have to re-calc dep flags, because the nodes don't have edges
    // until their packages get assigned, so everything looks extraneous
    calcDepFlags(this.idealTree)

    // yes, yes, this isn't the "original" version, but now that it's been
    // upgraded, we need to make sure we don't do the work to upgrade it
    // again, since it's now as new as can be.
    meta.originalLockfileVersion = defaultLockfileVersion
    this.finishTracker('idealTree:inflate')
    process.emit('timeEnd', 'idealTree:inflate')
  }

  // at this point we have a virtual tree with the actual root node's
  // package deps, which may be partly or entirely incomplete, invalid
  // or extraneous.
  [_buildDeps] () {
    process.emit('time', 'idealTree:buildDeps')
    const tree = this.idealTree.target
    tree.assertRootOverrides()
    this[_depsQueue].push(tree)
    // XXX also push anything that depends on a node with a name
    // in the override list
    log.silly('idealTree', 'buildDeps')
    this.addTracker('idealTree', tree.name, '')
    return this[_buildDepStep]()
      .then(() => process.emit('timeEnd', 'idealTree:buildDeps'))
  }

  async [_buildDepStep] () {
    // removes tracker of previous dependency in the queue
    if (this[_currentDep]) {
      const { location, name } = this[_currentDep]
      process.emit('timeEnd', `idealTree:${location || '#root'}`)
      this.finishTracker('idealTree', name, location)
      this[_currentDep] = null
    }

    if (!this[_depsQueue].length) {
      return this[_resolveLinks]()
    }

    // sort physically shallower deps up to the front of the queue,
    // because they'll affect things deeper in, then alphabetical
    this[_depsQueue].sort((a, b) =>
      (a.depth - b.depth) || localeCompare(a.path, b.path))

    const node = this[_depsQueue].shift()
    const bd = node.package.bundleDependencies
    const hasBundle = bd && Array.isArray(bd) && bd.length
    const { hasShrinkwrap } = node

    // if the node was already visited, or has since been removed from the
    // tree, skip over it and process the rest of the queue.  If a node has
    // a shrinkwrap, also skip it, because it's going to get its deps
    // satisfied by whatever's in that file anyway.
    if (this[_depsSeen].has(node) ||
        node.root !== this.idealTree ||
        hasShrinkwrap && !this[_complete]) {
      return this[_buildDepStep]()
    }

    this[_depsSeen].add(node)
    this[_currentDep] = node
    process.emit('time', `idealTree:${node.location || '#root'}`)

    // if we're loading a _complete_ ideal tree, for a --package-lock-only
    // installation for example, we have to crack open the tarball and
    // look inside if it has bundle deps or shrinkwraps.  note that this is
    // not necessary during a reification, because we just update the
    // ideal tree by reading bundles/shrinkwraps in place.
    // Don't bother if the node is from the actual tree and hasn't
    // been resolved, because we can't fetch it anyway, could be anything!
    const crackOpen = this[_complete] &&
      node !== this.idealTree &&
      node.resolved &&
      (hasBundle || hasShrinkwrap)
    if (crackOpen) {
      const Arborist = this.constructor
      const opt = { ...this.options }
      await cacache.tmp.withTmp(this.cache, opt, async path => {
        await pacote.extract(node.resolved, path, {
          ...opt,
          resolved: node.resolved,
          integrity: node.integrity,
        })

        if (hasShrinkwrap) {
          await new Arborist({ ...this.options, path })
            .loadVirtual({ root: node })
        }

        if (hasBundle) {
          await new Arborist({ ...this.options, path })
            .loadActual({ root: node, ignoreMissing: true })
        }
      })
    }

    // if any deps are missing or invalid, then we fetch the manifest for
    // the thing we want, and build a new dep node from that.
    // Then, find the ideal placement for that node.  The ideal placement
    // searches from the node's deps (or parent deps in the case of non-root
    // peer deps), and walks up the tree until it finds the highest spot
    // where it doesn't cause any conflicts.
    //
    // A conflict can be:
    // - A node by that name already exists at that location.
    // - The parent has a peer dep on that name
    // - One of the node's peer deps conflicts at that location, unless the
    //   peer dep is met by a node at that location, which is fine.
    //
    // If we create a new node, then build its ideal deps as well.
    //
    // Note: this is the same "maximally naive" deduping tree-building
    // algorithm that npm has used since v3.  In a case like this:
    //
    // root -> (a@1, b@1||2)
    // a -> (b@1)
    //
    // You'll end up with a tree like this:
    //
    // root
    // +-- a@1
    // |   +-- b@1
    // +-- b@2
    //
    // rather than this, more deduped, but just as correct tree:
    //
    // root
    // +-- a@1
    // +-- b@1
    //
    // Another way to look at it is that this algorithm favors getting higher
    // version deps at higher levels in the tree, even if that reduces
    // potential deduplication.
    //
    // Set `preferDedupe: true` in the options to replace the shallower
    // dep if allowed.

    const tasks = []
    const peerSource = this[_peerSetSource].get(node) || node
    for (const edge of this[_problemEdges](node)) {
      if (edge.peerConflicted) {
        continue
      }

      // peerSetSource is only relevant when we have a peerEntryEdge
      // otherwise we're setting regular non-peer deps as if they have
      // a virtual root of whatever brought in THIS node.
      // so we VR the node itself if the edge is not a peer
      const source = edge.peer ? peerSource : node

      const virtualRoot = this[_virtualRoot](source, true)
      // reuse virtual root if we already have one, but don't
      // try to do the override ahead of time, since we MAY be able
      // to create a more correct tree than the virtual root could.
      const vrEdge = virtualRoot && virtualRoot.edgesOut.get(edge.name)
      const vrDep = vrEdge && vrEdge.valid && vrEdge.to
      // only re-use the virtualRoot if it's a peer edge we're placing.
      // otherwise, we end up in situations where we override peer deps that
      // we could have otherwise found homes for.  Eg:
      // xy -> (x, y)
      // x -> PEER(z@1)
      // y -> PEER(z@2)
      // If xy is a dependency, we can resolve this like:
      // project
      // +-- xy
      // |   +-- y
      // |   +-- z@2
      // +-- x
      // +-- z@1
      // But if x and y are loaded in the same virtual root, then they will
      // be forced to agree on a version of z.
      const required = new Set([edge.from])
      const parent = edge.peer ? virtualRoot : null
      const dep = vrDep && vrDep.satisfies(edge) ? vrDep
        : await this[_nodeFromEdge](edge, parent, null, required)

      /* istanbul ignore next */
      debug(() => {
        if (!dep) {
          throw new Error('no dep??')
        }
      })

      tasks.push({ edge, dep })
    }

    const placeDeps = tasks
      .sort((a, b) => localeCompare(a.edge.name, b.edge.name))
      .map(({ edge, dep }) => new PlaceDep({
        edge,
        dep,

        explicitRequest: this[_explicitRequests].has(edge),
        updateNames: this[_updateNames],
        auditReport: this.auditReport,
        force: this[_force],
        preferDedupe: this[_preferDedupe],
        legacyBundling: this[_legacyBundling],
        strictPeerDeps: this[_strictPeerDeps],
        legacyPeerDeps: this.legacyPeerDeps,
        globalStyle: this[_globalStyle],
      }))

    const promises = []
    for (const pd of placeDeps) {
      // placing a dep is actually a tree of placing the dep itself
      // and all of its peer group that aren't already met by the tree
      depth({
        tree: pd,
        getChildren: pd => pd.children,
        visit: pd => {
          const { placed, edge, canPlace: cpd } = pd
          // if we didn't place anything, nothing to do here
          if (!placed) {
            return
          }

          // we placed something, that means we changed the tree
          if (placed.errors.length) {
            this[_loadFailures].add(placed)
          }
          this[_mutateTree] = true
          if (cpd.canPlaceSelf === OK) {
            for (const edgeIn of placed.edgesIn) {
              if (edgeIn === edge) {
                continue
              }
              const { from, valid, peerConflicted } = edgeIn
              if (!peerConflicted && !valid && !this[_depsSeen].has(from)) {
                this.addTracker('idealTree', from.name, from.location)
                this[_depsQueue].push(edgeIn.from)
              }
            }
          } else {
            /* istanbul ignore else - should be only OK or REPLACE here */
            if (cpd.canPlaceSelf === REPLACE) {
              // this may also create some invalid edges, for example if we're
              // intentionally causing something to get nested which was
              // previously placed in this location.
              for (const edgeIn of placed.edgesIn) {
                if (edgeIn === edge) {
                  continue
                }

                const { valid, peerConflicted } = edgeIn
                if (!valid && !peerConflicted) {
                  // if it's already been visited, we have to re-visit
                  // otherwise, just enqueue normally.
                  this[_depsSeen].delete(edgeIn.from)
                  this[_depsQueue].push(edgeIn.from)
                }
              }
            }
          }

          /* istanbul ignore if - should be impossible */
          if (cpd.canPlaceSelf === CONFLICT) {
            debug(() => {
              const er = new Error('placed with canPlaceSelf=CONFLICT')
              throw Object.assign(er, { placeDep: pd })
            })
            return
          }

          // lastly, also check for the missing deps of the node we placed,
          // and any holes created by pruning out conflicted peer sets.
          this[_depsQueue].push(placed)
          for (const dep of pd.needEvaluation) {
            this[_depsSeen].delete(dep)
            this[_depsQueue].push(dep)
          }

          // pre-fetch any problem edges, since we'll need these soon
          // if it fails at this point, though, dont' worry because it
          // may well be an optional dep that has gone missing.  it'll
          // fail later anyway.
          const from = fromPath(placed)
          promises.push(...this[_problemEdges](placed).map(e =>
            this[_fetchManifest](npa.resolve(e.name, e.spec, from))
              .catch(er => null)))
        },
      })
    }

    for (const { to } of node.edgesOut.values()) {
      if (to && to.isLink && to.target) {
        this[_linkNodes].add(to)
      }
    }

    await Promise.all(promises)
    return this[_buildDepStep]()
  }

  // loads a node from an edge, and then loads its peer deps (and their
  // peer deps, on down the line) into a virtual root parent.
  async [_nodeFromEdge] (edge, parent_, secondEdge, required) {
    // create a virtual root node with the same deps as the node that
    // is requesting this one, so that we can get all the peer deps in
    // a context where they're likely to be resolvable.
    // Note that the virtual root will also have virtual copies of the
    // targets of any child Links, so that they resolve appropriately.
    const parent = parent_ || this[_virtualRoot](edge.from)

    const spec = npa.resolve(edge.name, edge.spec, edge.from.path)
    const first = await this[_nodeFromSpec](edge.name, spec, parent, edge)

    // we might have a case where the parent has a peer dependency on
    // `foo@*` which resolves to v2, but another dep in the set has a
    // peerDependency on `foo@1`.  In that case, if we force it to be v2,
    // we're unnecessarily triggering an ERESOLVE.
    // If we have a second edge to worry about, and it's not satisfied
    // by the first node, try a second and see if that satisfies the
    // original edge here.
    const spec2 = secondEdge && npa.resolve(
      edge.name,
      secondEdge.spec,
      secondEdge.from.path
    )
    const second = secondEdge && !secondEdge.valid
      ? await this[_nodeFromSpec](edge.name, spec2, parent, secondEdge)
      : null

    // pick the second one if they're both happy with that, otherwise first
    const node = second && edge.valid ? second : first
    // ensure the one we want is the one that's placed
    node.parent = parent

    if (required.has(edge.from) && edge.type !== 'peerOptional' ||
        secondEdge && (
          required.has(secondEdge.from) && secondEdge.type !== 'peerOptional')) {
      required.add(node)
    }

    // keep track of the thing that caused this node to be included.
    const src = parent.sourceReference
    this[_peerSetSource].set(node, src)

    // do not load the peers along with the set if this is a global top pkg
    // otherwise we'll be tempted to put peers as other top-level installed
    // things, potentially clobbering what's there already, which is not
    // what we want.  the missing edges will be picked up on the next pass.
    if (this[_global] && edge.from.isProjectRoot) {
      return node
    }

    // otherwise, we have to make sure that our peers can go along with us.
    return this[_loadPeerSet](node, required)
  }

  [_virtualRoot] (node, reuse = false) {
    if (reuse && this[_virtualRoots].has(node)) {
      return this[_virtualRoots].get(node)
    }

    const vr = new Node({
      path: node.realpath,
      sourceReference: node,
      legacyPeerDeps: this.legacyPeerDeps,
      overrides: node.overrides,
    })

    // also need to set up any targets from any link deps, so that
    // they are properly reflected in the virtual environment
    for (const child of node.children.values()) {
      if (child.isLink) {
        new Node({
          path: child.realpath,
          sourceReference: child.target,
          root: vr,
        })
      }
    }

    this[_virtualRoots].set(node, vr)
    return vr
  }

  [_problemEdges] (node) {
    // skip over any bundled deps, they're not our problem.
    // Note that this WILL fetch bundled meta-deps which are also dependencies
    // but not listed as bundled deps.  When reifying, we first unpack any
    // nodes that have bundleDependencies, then do a loadActual on them, move
    // the nodes into the ideal tree, and then prune.  So, fetching those
    // possibly-bundled meta-deps at this point doesn't cause any worse
    // problems than a few unnecessary packument fetches.

    // also skip over any nodes in the tree that failed to load, since those
    // will crash the install later on anyway.
    const bd = node.isProjectRoot || node.isWorkspace ? null
      : node.package.bundleDependencies
    const bundled = new Set(bd || [])

    return [...node.edgesOut.values()]
      .filter(edge => {
        // If it's included in a bundle, we take whatever is specified.
        if (bundled.has(edge.name)) {
          return false
        }

        // If it's already been logged as a load failure, skip it.
        if (edge.to && this[_loadFailures].has(edge.to)) {
          return false
        }

        // If it's shrinkwrapped, we use what the shrinkwap wants.
        if (edge.to && edge.to.inShrinkwrap) {
          return false
        }

        // If the edge has no destination, that's a problem, unless
        // if it's peerOptional and not explicitly requested.
        if (!edge.to) {
          return edge.type !== 'peerOptional' ||
            this[_explicitRequests].has(edge)
        }

        // If the edge has an error, there's a problem.
        if (!edge.valid) {
          return true
        }

        // If the edge is a workspace, and it's valid, leave it alone
        if (edge.to.isWorkspace) {
          return false
        }

        // user explicitly asked to update this package by name, problem
        if (this[_updateNames].includes(edge.name)) {
          return true
        }

        // fixing a security vulnerability with this package, problem
        if (this[_isVulnerable](edge.to)) {
          return true
        }

        // user has explicitly asked to install this package, problem
        if (this[_explicitRequests].has(edge)) {
          return true
        }

        // No problems!
        return false
      })
  }

  async [_fetchManifest] (spec) {
    const options = {
      ...this.options,
      avoid: this[_avoidRange](spec.name),
    }
    // get the intended spec and stored metadata from yarn.lock file,
    // if available and valid.
    spec = this.idealTree.meta.checkYarnLock(spec, options)

    if (this[_manifests].has(spec.raw)) {
      return this[_manifests].get(spec.raw)
    } else {
      log.silly('fetch manifest', spec.raw)
      const p = pacote.manifest(spec, options)
        .then(mani => {
          this[_manifests].set(spec.raw, mani)
          return mani
        })
      this[_manifests].set(spec.raw, p)
      return p
    }
  }

  [_nodeFromSpec] (name, spec, parent, edge) {
    // pacote will slap integrity on its options, so we have to clone
    // the object so it doesn't get mutated.
    // Don't bother to load the manifest for link deps, because the target
    // might be within another package that doesn't exist yet.
    const { legacyPeerDeps } = this

    // spec is a directory, link it
    if (spec.type === 'directory') {
      return this[_linkFromSpec](name, spec, parent, edge)
    }

    // if the spec matches a workspace name, then see if the workspace node will
    // satisfy the edge. if it does, we return the workspace node to make sure it
    // takes priority.
    if (this.idealTree.workspaces && this.idealTree.workspaces.has(spec.name)) {
      const existingNode = this.idealTree.edgesOut.get(spec.name).to
      if (existingNode && existingNode.isWorkspace && existingNode.satisfies(edge)) {
        return edge.to
      }
    }

    // spec isn't a directory, and either isn't a workspace or the workspace we have
    // doesn't satisfy the edge. try to fetch a manifest and build a node from that.
    return this[_fetchManifest](spec)
      .then(pkg => new Node({ name, pkg, parent, legacyPeerDeps }), error => {
        error.requiredBy = edge.from.location || '.'

        // failed to load the spec, either because of enotarget or
        // fetch failure of some other sort.  save it so we can verify
        // later that it's optional, otherwise the error is fatal.
        const n = new Node({
          name,
          parent,
          error,
          legacyPeerDeps,
        })
        this[_loadFailures].add(n)
        return n
      })
  }

  [_linkFromSpec] (name, spec, parent, edge) {
    const realpath = spec.fetchSpec
    const { legacyPeerDeps } = this
    return rpj(realpath + '/package.json').catch(() => ({})).then(pkg => {
      const link = new Link({ name, parent, realpath, pkg, legacyPeerDeps })
      this[_linkNodes].add(link)
      return link
    })
  }

  // load all peer deps and meta-peer deps into the node's parent
  // At the end of this, the node's peer-type outward edges are all
  // resolved, and so are all of theirs, but other dep types are not.
  // We prefer to get peer deps that meet the requiring node's dependency,
  // if possible, since that almost certainly works (since that package was
  // developed with this set of deps) and will typically be more restrictive.
  // Note that the peers in the set can conflict either with each other,
  // or with a direct dependency from the virtual root parent!  In strict
  // mode, this is always an error.  In force mode, it never is, and we
  // prefer the parent's non-peer dep over a peer dep, or the version that
  // gets placed first.  In non-strict mode, we behave strictly if the
  // virtual root is based on the root project, and allow non-peer parent
  // deps to override, but throw if no preference can be determined.
  async [_loadPeerSet] (node, required) {
    const peerEdges = [...node.edgesOut.values()]
      // we typically only install non-optional peers, but we have to
      // factor them into the peerSet so that we can avoid conflicts
      .filter(e => e.peer && !(e.valid && e.to))
      .sort(({ name: a }, { name: b }) => localeCompare(a, b))

    for (const edge of peerEdges) {
      // already placed this one, and we're happy with it.
      if (edge.valid && edge.to) {
        continue
      }

      const parentEdge = node.parent.edgesOut.get(edge.name)
      const { isProjectRoot, isWorkspace } = node.parent.sourceReference
      const isMine = isProjectRoot || isWorkspace
      const conflictOK = this[_force] || !isMine && !this[_strictPeerDeps]

      if (!edge.to) {
        if (!parentEdge) {
          // easy, just put the thing there
          await this[_nodeFromEdge](edge, node.parent, null, required)
          continue
        } else {
          // if the parent's edge is very broad like >=1, and the edge in
          // question is something like 1.x, then we want to get a 1.x, not
          // a 2.x.  pass along the child edge as an advisory guideline.
          // if the parent edge doesn't satisfy the child edge, and the
          // child edge doesn't satisfy the parent edge, then we have
          // a conflict.  this is always a problem in strict mode, never
          // in force mode, and a problem in non-strict mode if this isn't
          // on behalf of our project.  in all such cases, we warn at least.
          const dep = await this[_nodeFromEdge](
            parentEdge,
            node.parent,
            edge,
            required
          )

          // hooray! that worked!
          if (edge.valid) {
            continue
          }

          // allow it.  either we're overriding, or it's not something
          // that will be installed by default anyway, and we'll fail when
          // we get to the point where we need to, if we need to.
          if (conflictOK || !required.has(dep)) {
            edge.peerConflicted = true
            continue
          }

          // problem
          this[_failPeerConflict](edge, parentEdge)
        }
      }

      // There is something present already, and we're not happy about it
      // See if the thing we WOULD be happy with is also going to satisfy
      // the other dependents on the current node.
      const current = edge.to
      const dep = await this[_nodeFromEdge](edge, null, null, required)
      if (dep.canReplace(current)) {
        await this[_nodeFromEdge](edge, node.parent, null, required)
        continue
      }

      // at this point we know that there is a dep there, and
      // we don't like it.  always fail strictly, always allow forcibly or
      // in non-strict mode if it's not our fault.  don't warn here, because
      // we are going to warn again when we place the deps, if we end up
      // overriding for something else.  If the thing that has this dep
      // isn't also required, then there's a good chance we won't need it,
      // so allow it for now and let it conflict if it turns out to actually
      // be necessary for the installation.
      if (conflictOK || !required.has(edge.from)) {
        continue
      }

      // ok, it's the root, or we're in unforced strict mode, so this is bad
      this[_failPeerConflict](edge, parentEdge)
    }
    return node
  }

  [_failPeerConflict] (edge, currentEdge) {
    const expl = this[_explainPeerConflict](edge, currentEdge)
    throw Object.assign(new Error('unable to resolve dependency tree'), expl)
  }

  [_explainPeerConflict] (edge, currentEdge) {
    const node = edge.from
    const curNode = node.resolve(edge.name)
    const current = curNode.explain()
    return {
      code: 'ERESOLVE',
      current,
      // it SHOULD be impossible to get here without a current node in place,
      // but this at least gives us something report on when bugs creep into
      // the tree handling logic.
      currentEdge: currentEdge ? currentEdge.explain() : null,
      edge: edge.explain(),
      strictPeerDeps: this[_strictPeerDeps],
      force: this[_force],
    }
  }

  // go through all the links in the this[_linkNodes] set
  // for each one:
  // - if outside the root, ignore it, assume it's fine, it's not our problem
  // - if a node in the tree already, assign the target to that node.
  // - if a path under an existing node, then assign that as the fsParent,
  //   and add it to the _depsQueue
  //
  // call buildDepStep if anything was added to the queue, otherwise we're done
  [_resolveLinks] () {
    for (const link of this[_linkNodes]) {
      this[_linkNodes].delete(link)

      // link we never ended up placing, skip it
      if (link.root !== this.idealTree) {
        continue
      }

      const tree = this.idealTree.target
      const external = !link.target.isDescendantOf(tree)

      // outside the root, somebody else's problem, ignore it
      if (external && !this[_follow]) {
        continue
      }

      // didn't find a parent for it or it has not been seen yet
      // so go ahead and process it.
      const unseenLink = (link.target.parent || link.target.fsParent) &&
        !this[_depsSeen].has(link.target)

      if (this[_follow] &&
          !link.target.parent &&
          !link.target.fsParent ||
          unseenLink) {
        this.addTracker('idealTree', link.target.name, link.target.location)
        this[_depsQueue].push(link.target)
      }
    }

    if (this[_depsQueue].length) {
      return this[_buildDepStep]()
    }
  }

  [_fixDepFlags] () {
    process.emit('time', 'idealTree:fixDepFlags')
    const metaFromDisk = this.idealTree.meta.loadedFromDisk
    const flagsSuspect = this[_flagsSuspect]
    const mutateTree = this[_mutateTree]
    // if the options set prune:false, then we don't prune, but we still
    // mark the extraneous items in the tree if we modified it at all.
    // If we did no modifications, we just iterate over the extraneous nodes.
    // if we started with an empty tree, then the dep flags are already
    // all set to true, and there can be nothing extraneous, so there's
    // nothing to prune, because we built it from scratch.  if we didn't
    // add or remove anything, then also nothing to do.
    if (metaFromDisk && mutateTree) {
      resetDepFlags(this.idealTree)
    }

    // update all the dev/optional/etc flags in the tree
    // either we started with a fresh tree, or we
    // reset all the flags to find the extraneous nodes.
    //
    // if we started from a blank slate, or changed something, then
    // the dep flags will be all set to true.
    if (!metaFromDisk || mutateTree) {
      calcDepFlags(this.idealTree)
    } else {
      // otherwise just unset all the flags on the root node
      // since they will sometimes have the default value
      this.idealTree.extraneous = false
      this.idealTree.dev = false
      this.idealTree.optional = false
      this.idealTree.devOptional = false
      this.idealTree.peer = false
    }

    // at this point, any node marked as extraneous should be pruned.
    // if we started from a shrinkwrap, and then added/removed something,
    // then the tree is suspect.  Prune what is marked as extraneous.
    // otherwise, don't bother.
    const needPrune = metaFromDisk && (mutateTree || flagsSuspect)
    if (this[_prune] && needPrune) {
      this[_idealTreePrune]()
    }

    process.emit('timeEnd', 'idealTree:fixDepFlags')
  }

  [_idealTreePrune] () {
    for (const node of this.idealTree.inventory.filter(n => n.extraneous)) {
      node.parent = null
    }
  }

  [_pruneFailedOptional] () {
    for (const node of this[_loadFailures]) {
      if (!node.optional) {
        throw node.errors[0]
      }

      const set = optionalSet(node)
      for (const node of set) {
        node.parent = null
      }
    }
  }
}

}, function(modId) { var map = {"../../lib/realpath.js":1653046641889,"../tree-check.js":1653046641890,"../can-place-dep.js":1653046641892,"../place-dep.js":1653046641895,"../debug.js":1653046641891,"../from-path.js":1653046641901,"../calc-dep-flags.js":1653046641908,"../shrinkwrap.js":1653046641909,"../node.js":1653046641898,"../link.js":1653046641896,"../add-rm-pkg-deps.js":1653046641881,"../optional-set.js":1653046641913,"../relpath.js":1653046641897,"../reset-dep-flags.js":1653046641914}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641889, function(require, module, exports) {
// look up the realpath, but cache stats to minimize overhead
// If the parent folder is in  the realpath cache, then we just
// lstat the child, since there's no need to do a full realpath
// This is not a separate module, and is much simpler than Node's
// built-in fs.realpath, because we only care about symbolic links,
// so we can handle many fewer edge cases.

const fs = require('fs')
const promisify = require('util').promisify
const readlink = promisify(fs.readlink)
const lstat = promisify(fs.lstat)
const { resolve, basename, dirname } = require('path')

const realpathCached = (path, rpcache, stcache, depth) => {
  // just a safety against extremely deep eloops
  /* istanbul ignore next */
  if (depth > 2000) {
    throw eloop(path)
  }

  path = resolve(path)
  if (rpcache.has(path)) {
    return Promise.resolve(rpcache.get(path))
  }

  const dir = dirname(path)
  const base = basename(path)

  if (base && rpcache.has(dir)) {
    return realpathChild(dir, base, rpcache, stcache, depth)
  }

  // if it's the root, then we know it's real
  if (!base) {
    rpcache.set(dir, dir)
    return Promise.resolve(dir)
  }

  // the parent, what is that?
  // find out, and then come back.
  return realpathCached(dir, rpcache, stcache, depth + 1).then(() =>
    realpathCached(path, rpcache, stcache, depth + 1))
}

const lstatCached = (path, stcache) => {
  if (stcache.has(path)) {
    return Promise.resolve(stcache.get(path))
  }

  const p = lstat(path).then(st => {
    stcache.set(path, st)
    return st
  })
  stcache.set(path, p)
  return p
}

// This is a slight fib, as it doesn't actually occur during a stat syscall.
// But file systems are giant piles of lies, so whatever.
const eloop = path =>
  Object.assign(new Error(
    `ELOOP: too many symbolic links encountered, stat '${path}'`), {
    errno: -62,
    syscall: 'stat',
    code: 'ELOOP',
    path: path,
  })

const realpathChild = (dir, base, rpcache, stcache, depth) => {
  const realdir = rpcache.get(dir)
  // that unpossible
  /* istanbul ignore next */
  if (typeof realdir === 'undefined') {
    throw new Error('in realpathChild without parent being in realpath cache')
  }

  const realish = resolve(realdir, base)
  return lstatCached(realish, stcache).then(st => {
    if (!st.isSymbolicLink()) {
      rpcache.set(resolve(dir, base), realish)
      return realish
    }

    return readlink(realish).then(target => {
      const resolved = resolve(realdir, target)
      if (realish === resolved) {
        throw eloop(realish)
      }

      return realpathCached(resolved, rpcache, stcache, depth + 1)
    }).then(real => {
      rpcache.set(resolve(dir, base), real)
      return real
    })
  })
}

module.exports = realpathCached

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641890, function(require, module, exports) {
const debug = require('./debug.js')

const checkTree = (tree, checkUnreachable = true) => {
  const log = [['START TREE CHECK', tree.path]]

  // this can only happen in tests where we have a "tree" object
  // that isn't actually a tree.
  if (!tree.root || !tree.root.inventory) {
    return tree
  }

  const { inventory } = tree.root
  const seen = new Set()
  const check = (node, via = tree, viaType = 'self') => {
    log.push([
      'CHECK',
      node && node.location,
      via && via.location,
      viaType,
      'seen=' + seen.has(node),
      'promise=' + !!(node && node.then),
      'root=' + !!(node && node.isRoot),
    ])

    if (!node || seen.has(node) || node.then) {
      return
    }

    seen.add(node)

    if (node.isRoot && node !== tree.root) {
      throw Object.assign(new Error('double root'), {
        node: node.path,
        realpath: node.realpath,
        tree: tree.path,
        root: tree.root.path,
        via: via.path,
        viaType,
        log,
      })
    }

    if (node.root !== tree.root) {
      throw Object.assign(new Error('node from other root in tree'), {
        node: node.path,
        realpath: node.realpath,
        tree: tree.path,
        root: tree.root.path,
        via: via.path,
        viaType,
        otherRoot: node.root && node.root.path,
        log,
      })
    }

    if (!node.isRoot && node.inventory.size !== 0) {
      throw Object.assign(new Error('non-root has non-zero inventory'), {
        node: node.path,
        tree: tree.path,
        root: tree.root.path,
        via: via.path,
        viaType,
        inventory: [...node.inventory.values()].map(node =>
          [node.path, node.location]),
        log,
      })
    }

    if (!node.isRoot && !inventory.has(node) && !node.dummy) {
      throw Object.assign(new Error('not in inventory'), {
        node: node.path,
        tree: tree.path,
        root: tree.root.path,
        via: via.path,
        viaType,
        log,
      })
    }

    const devEdges = [...node.edgesOut.values()].filter(e => e.dev)
    if (!node.isTop && devEdges.length) {
      throw Object.assign(new Error('dev edges on non-top node'), {
        node: node.path,
        tree: tree.path,
        root: tree.root.path,
        via: via.path,
        viaType,
        devEdges: devEdges.map(e => [e.type, e.name, e.spec, e.error]),
        log,
      })
    }

    if (node.path === tree.root.path && node !== tree.root) {
      throw Object.assign(new Error('node with same path as root'), {
        node: node.path,
        tree: tree.path,
        root: tree.root.path,
        via: via.path,
        viaType,
        log,
      })
    }

    if (!node.isLink && node.path !== node.realpath) {
      throw Object.assign(new Error('non-link with mismatched path/realpath'), {
        node: node.path,
        tree: tree.path,
        realpath: node.realpath,
        root: tree.root.path,
        via: via.path,
        viaType,
        log,
      })
    }

    const { parent, fsParent, target } = node
    check(parent, node, 'parent')
    check(fsParent, node, 'fsParent')
    check(target, node, 'target')
    log.push(['CHILDREN', node.location, ...node.children.keys()])
    for (const kid of node.children.values()) {
      check(kid, node, 'children')
    }
    for (const kid of node.fsChildren) {
      check(kid, node, 'fsChildren')
    }
    for (const link of node.linksIn) {
      check(link, node, 'linksIn')
    }
    for (const top of node.tops) {
      check(top, node, 'tops')
    }
    log.push(['DONE', node.location])
  }
  check(tree)
  if (checkUnreachable) {
    for (const node of inventory.values()) {
      if (!seen.has(node) && node !== tree.root) {
        throw Object.assign(new Error('unreachable in inventory'), {
          node: node.path,
          realpath: node.realpath,
          location: node.location,
          root: tree.root.path,
          tree: tree.path,
          log,
        })
      }
    }
  }
  return tree
}

// should only ever run this check in debug mode
module.exports = tree => tree
debug(() => module.exports = checkTree)

}, function(modId) { var map = {"./debug.js":1653046641891}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641891, function(require, module, exports) {
// certain assertions we should do only when testing arborist itself, because
// they are too expensive or aggressive and would break user programs if we
// miss a situation where they are actually valid.
//
// call like this:
//
// /* istanbul ignore next - debug check */
// debug(() => {
//   if (someExpensiveCheck)
//     throw new Error('expensive check should have returned false')
// })

// run in debug mode if explicitly requested, running arborist tests,
// or working in the arborist project directory.

const debug = process.env.ARBORIST_DEBUG !== '0' && (
  process.env.ARBORIST_DEBUG === '1' ||
  /\barborist\b/.test(process.env.NODE_DEBUG || '') ||
  process.env.npm_package_name === '@npmcli/arborist' &&
  ['test', 'snap'].includes(process.env.npm_lifecycle_event) ||
  process.cwd() === require('path').resolve(__dirname, '..')
)

module.exports = debug ? fn => fn() : () => {}
const red = process.stderr.isTTY ? msg => `\x1B[31m${msg}\x1B[39m` : m => m
module.exports.log = (...msg) => module.exports(() => {
  const { format } = require('util')
  const prefix = `\n${process.pid} ${red(format(msg.shift()))} `
  msg = (prefix + format(...msg).trim().split('\n').join(prefix)).trim()
  console.error(msg)
})

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641892, function(require, module, exports) {
// Internal methods used by buildIdealTree.
// Answer the question: "can I put this dep here?"
//
// IMPORTANT: *nothing* in this class should *ever* modify or mutate the tree
// at all.  The contract here is strictly limited to read operations.  We call
// this in the process of walking through the ideal tree checking many
// different potential placement targets for a given node.  If a change is made
// to the tree along the way, that can cause serious problems!
//
// In order to enforce this restriction, in debug mode, canPlaceDep() will
// snapshot the tree at the start of the process, and then at the end, will
// verify that it still matches the snapshot, and throw an error if any changes
// occurred.
//
// The algorithm is roughly like this:
// - check the node itself:
//   - if there is no version present, and no conflicting edges from target,
//     OK, provided all peers can be placed at or above the target.
//   - if the current version matches, KEEP
//   - if there is an older version present, which can be replaced, then
//     - if satisfying and preferDedupe? KEEP
//     - else: REPLACE
//   - if there is a newer version present, and preferDedupe, REPLACE
//   - if the version present satisfies the edge, KEEP
//   - else: CONFLICT
// - if the node is not in conflict, check each of its peers:
//   - if the peer can be placed in the target, continue
//   - else if the peer can be placed in a parent, and there is no other
//     conflicting version shadowing it, continue
//   - else CONFLICT
// - If the peers are not in conflict, return the original node's value
//
// An exception to this logic is that if the target is the deepest location
// that a node can be placed, and the conflicting node can be placed deeper,
// then we will return REPLACE rather than CONFLICT, and Arborist will queue
// the replaced node for resolution elsewhere.

const localeCompare = require('@isaacs/string-locale-compare')('en')
const semver = require('semver')
const debug = require('./debug.js')
const peerEntrySets = require('./peer-entry-sets.js')
const deepestNestingTarget = require('./deepest-nesting-target.js')

const CONFLICT = Symbol('CONFLICT')
const OK = Symbol('OK')
const REPLACE = Symbol('REPLACE')
const KEEP = Symbol('KEEP')

class CanPlaceDep {
  // dep is a dep that we're trying to place.  it should already live in
  // a virtual tree where its peer set is loaded as children of the root.
  // target is the actual place where we're trying to place this dep
  // in a node_modules folder.
  // edge is the edge that we're trying to satisfy with this placement.
  // parent is the CanPlaceDep object of the entry node when placing a peer.
  constructor (options) {
    const {
      dep,
      target,
      edge,
      preferDedupe,
      parent = null,
      peerPath = [],
      explicitRequest = false,
    } = options

    debug(() => {
      if (!dep) {
        throw new Error('no dep provided to CanPlaceDep')
      }

      if (!target) {
        throw new Error('no target provided to CanPlaceDep')
      }

      if (!edge) {
        throw new Error('no edge provided to CanPlaceDep')
      }

      this._treeSnapshot = JSON.stringify([...target.root.inventory.entries()]
        .map(([loc, { packageName, version, resolved }]) => {
          return [loc, packageName, version, resolved]
        }).sort(([a], [b]) => localeCompare(a, b)))
    })

    // the result of whether we can place it or not
    this.canPlace = null
    // if peers conflict, but this one doesn't, then that is useful info
    this.canPlaceSelf = null

    this.dep = dep
    this.target = target
    this.edge = edge
    this.explicitRequest = explicitRequest

    // preventing cycles when we check peer sets
    this.peerPath = peerPath
    // we always prefer to dedupe peers, because they are trying
    // a bit harder to be singletons.
    this.preferDedupe = !!preferDedupe || edge.peer
    this.parent = parent
    this.children = []

    this.isSource = target === this.peerSetSource
    this.name = edge.name
    this.current = target.children.get(this.name)
    this.targetEdge = target.edgesOut.get(this.name)
    this.conflicts = new Map()

    // check if this dep was already subject to a peerDep override while
    // building the peerSet.
    this.edgeOverride = !dep.satisfies(edge)

    this.canPlace = this.checkCanPlace()
    if (!this.canPlaceSelf) {
      this.canPlaceSelf = this.canPlace
    }

    debug(() => {
      const treeSnapshot = JSON.stringify([...target.root.inventory.entries()]
        .map(([loc, { packageName, version, resolved }]) => {
          return [loc, packageName, version, resolved]
        }).sort(([a], [b]) => localeCompare(a, b)))
      /* istanbul ignore if */
      if (this._treeSnapshot !== treeSnapshot) {
        throw Object.assign(new Error('tree changed in CanPlaceDep'), {
          expect: this._treeSnapshot,
          actual: treeSnapshot,
        })
      }
    })
  }

  checkCanPlace () {
    const { target, targetEdge, current, dep } = this

    // if the dep failed to load, we're going to fail the build or
    // prune it out anyway, so just move forward placing/replacing it.
    if (dep.errors.length) {
      return current ? REPLACE : OK
    }

    // cannot place peers inside their dependents, except for tops
    if (targetEdge && targetEdge.peer && !target.isTop) {
      return CONFLICT
    }

    // skip this test if there's a current node, because we might be able
    // to dedupe against it anyway
    if (!current &&
        targetEdge &&
        !dep.satisfies(targetEdge) &&
        targetEdge !== this.edge) {
      return CONFLICT
    }

    return current ? this.checkCanPlaceCurrent() : this.checkCanPlaceNoCurrent()
  }

  // we know that the target has a dep by this name in its node_modules
  // already.  Can return KEEP, REPLACE, or CONFLICT.
  checkCanPlaceCurrent () {
    const { preferDedupe, explicitRequest, current, target, edge, dep } = this

    if (dep.matches(current)) {
      if (current.satisfies(edge) || this.edgeOverride) {
        return explicitRequest ? REPLACE : KEEP
      }
    }

    const { version: curVer } = current
    const { version: newVer } = dep
    const tryReplace = curVer && newVer && semver.gte(newVer, curVer)
    if (tryReplace && dep.canReplace(current)) {
      // It's extremely rare that a replaceable node would be a conflict, if
      // the current one wasn't a conflict, but it is theoretically possible
      // if peer deps are pinned.  In that case we treat it like any other
      // conflict, and keep trying.
      const cpp = this.canPlacePeers(REPLACE)
      if (cpp !== CONFLICT) {
        return cpp
      }
    }

    // ok, can't replace the current with new one, but maybe current is ok?
    if (current.satisfies(edge) && (!explicitRequest || preferDedupe)) {
      return KEEP
    }

    // if we prefer deduping, then try replacing newer with older
    if (preferDedupe && !tryReplace && dep.canReplace(current)) {
      const cpp = this.canPlacePeers(REPLACE)
      if (cpp !== CONFLICT) {
        return cpp
      }
    }

    // Check for interesting cases!
    // First, is this the deepest place that this thing can go, and NOT the
    // deepest place where the conflicting dep can go?  If so, replace it,
    // and let it re-resolve deeper in the tree.
    const myDeepest = this.deepestNestingTarget

    // ok, i COULD be placed deeper, so leave the current one alone.
    if (target !== myDeepest) {
      return CONFLICT
    }

    // if we are not checking a peerDep, then we MUST place it here, in the
    // target that has a non-peer dep on it.
    if (!edge.peer && target === edge.from) {
      return this.canPlacePeers(REPLACE)
    }

    // if we aren't placing a peer in a set, then we're done here.
    // This is ignored because it SHOULD be redundant, as far as I can tell,
    // with the deepest target and target===edge.from tests.  But until we
    // can prove that isn't possible, this condition is here for safety.
    /* istanbul ignore if - allegedly impossible */
    if (!this.parent && !edge.peer) {
      return CONFLICT
    }

    // check the deps in the peer group for each edge into that peer group
    // if ALL of them can be pushed deeper, or if it's ok to replace its
    // members with the contents of the new peer group, then we're good.
    let canReplace = true
    for (const [entryEdge, currentPeers] of peerEntrySets(current)) {
      if (entryEdge === this.edge || entryEdge === this.peerEntryEdge) {
        continue
      }

      // First, see if it's ok to just replace the peerSet entirely.
      // we do this by walking out from the entryEdge, because in a case like
      // this:
      //
      // v -> PEER(a@1||2)
      // a@1 -> PEER(b@1)
      // a@2 -> PEER(b@2)
      // b@1 -> PEER(a@1)
      // b@2 -> PEER(a@2)
      //
      // root
      // +-- v
      // +-- a@2
      // +-- b@2
      //
      // Trying to place a peer group of (a@1, b@1) would fail to note that
      // they can be replaced, if we did it by looping 1 by 1.  If we are
      // replacing something, we don't have to check its peer deps, because
      // the peerDeps in the placed peerSet will presumably satisfy.
      const entryNode = entryEdge.to
      const entryRep = dep.parent.children.get(entryNode.name)
      if (entryRep) {
        if (entryRep.canReplace(entryNode, dep.parent.children.keys())) {
          continue
        }
      }

      let canClobber = !entryRep
      if (!entryRep) {
        const peerReplacementWalk = new Set([entryNode])
        OUTER: for (const currentPeer of peerReplacementWalk) {
          for (const edge of currentPeer.edgesOut.values()) {
            if (!edge.peer || !edge.valid) {
              continue
            }
            const rep = dep.parent.children.get(edge.name)
            if (!rep) {
              if (edge.to) {
                peerReplacementWalk.add(edge.to)
              }
              continue
            }
            if (!rep.satisfies(edge)) {
              canClobber = false
              break OUTER
            }
          }
        }
      }
      if (canClobber) {
        continue
      }

      // ok, we can't replace, but maybe we can nest the current set deeper?
      let canNestCurrent = true
      for (const currentPeer of currentPeers) {
        if (!canNestCurrent) {
          break
        }

        // still possible to nest this peerSet
        const curDeep = deepestNestingTarget(entryEdge.from, currentPeer.name)
        if (curDeep === target || target.isDescendantOf(curDeep)) {
          canNestCurrent = false
          canReplace = false
        }
        if (canNestCurrent) {
          continue
        }
      }
    }

    // if we can nest or replace all the current peer groups, we can replace.
    if (canReplace) {
      return this.canPlacePeers(REPLACE)
    }

    return CONFLICT
  }

  checkCanPlaceNoCurrent () {
    const { target, peerEntryEdge, dep, name } = this

    // check to see what that name resolves to here, and who may depend on
    // being able to reach it by crawling up past the parent.  we know
    // that it's not the target's direct child node, and if it was a direct
    // dep of the target, we would have conflicted earlier.
    const current = target !== peerEntryEdge.from && target.resolve(name)
    if (current) {
      for (const edge of current.edgesIn.values()) {
        if (edge.from.isDescendantOf(target) && edge.valid) {
          if (!dep.satisfies(edge)) {
            return CONFLICT
          }
        }
      }
    }

    // no objections, so this is fine as long as peers are ok here.
    return this.canPlacePeers(OK)
  }

  get deepestNestingTarget () {
    const start = this.parent ? this.parent.deepestNestingTarget
      : this.edge.from
    return deepestNestingTarget(start, this.name)
  }

  get conflictChildren () {
    return this.allChildren.filter(c => c.canPlace === CONFLICT)
  }

  get allChildren () {
    const set = new Set(this.children)
    for (const child of set) {
      for (const grandchild of child.children) {
        set.add(grandchild)
      }
    }
    return [...set]
  }

  get top () {
    return this.parent ? this.parent.top : this
  }

  // check if peers can go here.  returns state or CONFLICT
  canPlacePeers (state) {
    this.canPlaceSelf = state
    if (this._canPlacePeers) {
      return this._canPlacePeers
    }

    // TODO: represent peerPath in ERESOLVE error somehow?
    const peerPath = [...this.peerPath, this.dep]
    let sawConflict = false
    for (const peerEdge of this.dep.edgesOut.values()) {
      if (!peerEdge.peer || !peerEdge.to || peerPath.includes(peerEdge.to)) {
        continue
      }
      const peer = peerEdge.to
      // it may be the case that the *initial* dep can be nested, but a peer
      // of that dep needs to be placed shallower, because the target has
      // a peer dep on the peer as well.
      const target = deepestNestingTarget(this.target, peer.name)
      const cpp = new CanPlaceDep({
        dep: peer,
        target,
        parent: this,
        edge: peerEdge,
        peerPath,
        // always place peers in preferDedupe mode
        preferDedupe: true,
      })
      /* istanbul ignore next */
      debug(() => {
        if (this.children.some(c => c.dep === cpp.dep)) {
          throw new Error('checking same dep repeatedly')
        }
      })
      this.children.push(cpp)

      if (cpp.canPlace === CONFLICT) {
        sawConflict = true
      }
    }

    this._canPlacePeers = sawConflict ? CONFLICT : state
    return this._canPlacePeers
  }

  // what is the node that is causing this peerSet to be placed?
  get peerSetSource () {
    return this.parent ? this.parent.peerSetSource : this.edge.from
  }

  get peerEntryEdge () {
    return this.top.edge
  }

  static get CONFLICT () {
    return CONFLICT
  }

  static get OK () {
    return OK
  }

  static get REPLACE () {
    return REPLACE
  }

  static get KEEP () {
    return KEEP
  }

  get description () {
    const { canPlace } = this
    return canPlace && canPlace.description ||
    /* istanbul ignore next - old node affordance */ canPlace
  }
}

module.exports = CanPlaceDep

}, function(modId) { var map = {"./debug.js":1653046641891,"./peer-entry-sets.js":1653046641893,"./deepest-nesting-target.js":1653046641894}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641893, function(require, module, exports) {
// Given a node in a tree, return all of the peer dependency sets that
// it is a part of, with the entry (top or non-peer) edges into the sets
// identified.
//
// With this information, we can determine whether it is appropriate to
// replace the entire peer set with another (and remove the old one),
// push the set deeper into the tree, and so on.
//
// Returns a Map of { edge => Set(peerNodes) },

const peerEntrySets = node => {
  // this is the union of all peer groups that the node is a part of
  // later, we identify all of the entry edges, and create a set of
  // 1 or more overlapping sets that this node is a part of.
  const unionSet = new Set([node])
  for (const node of unionSet) {
    for (const edge of node.edgesOut.values()) {
      if (edge.valid && edge.peer && edge.to) {
        unionSet.add(edge.to)
      }
    }
    for (const edge of node.edgesIn) {
      if (edge.valid && edge.peer) {
        unionSet.add(edge.from)
      }
    }
  }
  const entrySets = new Map()
  for (const peer of unionSet) {
    for (const edge of peer.edgesIn) {
      // if not valid, it doesn't matter anyway.  either it's been previously
      // peerConflicted, or it's the thing we're interested in replacing.
      if (!edge.valid) {
        continue
      }
      // this is the entry point into the peer set
      if (!edge.peer || edge.from.isTop) {
        // get the subset of peer brought in by this peer entry edge
        const sub = new Set([peer])
        for (const peer of sub) {
          for (const edge of peer.edgesOut.values()) {
            if (edge.valid && edge.peer && edge.to) {
              sub.add(edge.to)
            }
          }
        }
        // if this subset does not include the node we are focused on,
        // then it is not relevant for our purposes.  Example:
        //
        // a -> (b, c, d)
        // b -> PEER(d) b -> d -> e -> f <-> g
        // c -> PEER(f, h) c -> (f <-> g, h -> g)
        // d -> PEER(e) d -> e -> f <-> g
        // e -> PEER(f)
        // f -> PEER(g)
        // g -> PEER(f)
        // h -> PEER(g)
        //
        // The unionSet(e) will include c, but we don't actually care about
        // it.  We only expanded to the edge of the peer nodes in order to
        // find the entry edges that caused the inclusion of peer sets
        // including (e), so we want:
        //   Map{
        //     Edge(a->b) => Set(b, d, e, f, g)
        //     Edge(a->d) => Set(d, e, f, g)
        //   }
        if (sub.has(node)) {
          entrySets.set(edge, sub)
        }
      }
    }
  }

  return entrySets
}

module.exports = peerEntrySets

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641894, function(require, module, exports) {
// given a starting node, what is the *deepest* target where name could go?
// This is not on the Node class for the simple reason that we sometimes
// need to check the deepest *potential* target for a Node that is not yet
// added to the tree where we are checking.
const deepestNestingTarget = (start, name) => {
  for (const target of start.ancestry()) {
    // note: this will skip past the first target if edge is peer
    if (target.isProjectRoot || !target.resolveParent || target.globalTop) {
      return target
    }
    const targetEdge = target.edgesOut.get(name)
    if (!targetEdge || !targetEdge.peer) {
      return target
    }
  }
}

module.exports = deepestNestingTarget

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641895, function(require, module, exports) {
// Given a dep, a node that depends on it, and the edge representing that
// dependency, place the dep somewhere in the node's tree, and all of its
// peer dependencies.
//
// Handles all of the tree updating needed to place the dep, including
// removing replaced nodes, pruning now-extraneous or invalidated nodes,
// and saves a set of what was placed and what needs re-evaluation as
// a result.

const localeCompare = require('@isaacs/string-locale-compare')('en')
const log = require('proc-log')
const deepestNestingTarget = require('./deepest-nesting-target.js')
const CanPlaceDep = require('./can-place-dep.js')
const {
  KEEP,
  CONFLICT,
} = CanPlaceDep
const debug = require('./debug.js')

const Link = require('./link.js')
const gatherDepSet = require('./gather-dep-set.js')
const peerEntrySets = require('./peer-entry-sets.js')

class PlaceDep {
  constructor (options) {
    const {
      dep,
      edge,
      parent = null,
    } = options
    this.name = edge.name
    this.dep = dep
    this.edge = edge
    this.canPlace = null

    this.target = null
    this.placed = null

    // inherit all these fields from the parent to ensure consistency.
    const {
      preferDedupe,
      force,
      explicitRequest,
      updateNames,
      auditReport,
      legacyBundling,
      strictPeerDeps,
      legacyPeerDeps,
      globalStyle,
    } = parent || options
    Object.assign(this, {
      preferDedupe,
      force,
      explicitRequest,
      updateNames,
      auditReport,
      legacyBundling,
      strictPeerDeps,
      legacyPeerDeps,
      globalStyle,
    })

    this.children = []
    this.parent = parent
    this.peerConflict = null

    this.needEvaluation = new Set()

    this.checks = new Map()

    this.place()
  }

  place () {
    const {
      edge,
      dep,
      preferDedupe,
      globalStyle,
      legacyBundling,
      explicitRequest,
      updateNames,
      checks,
    } = this

    // nothing to do if the edge is fine as it is
    if (edge.to &&
        !edge.error &&
        !explicitRequest &&
        !updateNames.includes(edge.name) &&
        !this.isVulnerable(edge.to)) {
      return
    }

    // walk up the tree until we hit either a top/root node, or a place
    // where the dep is not a peer dep.
    const start = this.getStartNode()

    let canPlace = null
    let canPlaceSelf = null
    for (const target of start.ancestry()) {
      // if the current location has a peerDep on it, then we can't place here
      // this is pretty rare to hit, since we always prefer deduping peers,
      // and the getStartNode will start us out above any peers from the
      // thing that depends on it.  but we could hit it with something like:
      //
      // a -> (b@1, c@1)
      // +-- c@1
      // +-- b -> PEEROPTIONAL(v) (c@2)
      //     +-- c@2 -> (v)
      //
      // So we check if we can place v under c@2, that's fine.
      // Then we check under b, and can't, because of the optional peer dep.
      // but we CAN place it under a, so the correct thing to do is keep
      // walking up the tree.
      const targetEdge = target.edgesOut.get(edge.name)
      if (!target.isTop && targetEdge && targetEdge.peer) {
        continue
      }

      const cpd = new CanPlaceDep({
        dep,
        edge,
        // note: this sets the parent's canPlace as the parent of this
        // canPlace, but it does NOT add this canPlace to the parent's
        // children.  This way, we can know that it's a peer dep, and
        // get the top edge easily, while still maintaining the
        // tree of checks that factored into the original decision.
        parent: this.parent && this.parent.canPlace,
        target,
        preferDedupe,
        explicitRequest: this.explicitRequest,
      })
      checks.set(target, cpd)

      // It's possible that a "conflict" is a conflict among the *peers* of
      // a given node we're trying to place, but there actually is no current
      // node.  Eg,
      // root -> (a, b)
      // a -> PEER(c)
      // b -> PEER(d)
      // d -> PEER(c@2)
      // We place (a), and get a peer of (c) along with it.
      // then we try to place (b), and get CONFLICT in the check, because
      // of the conflicting peer from (b)->(d)->(c@2).  In that case, we
      // should treat (b) and (d) as OK, and place them in the last place
      // where they did not themselves conflict, and skip c@2 if conflict
      // is ok by virtue of being forced or not ours and not strict.
      if (cpd.canPlaceSelf !== CONFLICT) {
        canPlaceSelf = cpd
      }

      // we found a place this can go, along with all its peer friends.
      // we break when we get the first conflict
      if (cpd.canPlace !== CONFLICT) {
        canPlace = cpd
      } else {
        break
      }

      // if it's a load failure, just plop it in the first place attempted,
      // since we're going to crash the build or prune it out anyway.
      // but, this will frequently NOT be a successful canPlace, because
      // it'll have no version or other information.
      if (dep.errors.length) {
        break
      }

      // nest packages like npm v1 and v2
      // very disk-inefficient
      if (legacyBundling) {
        break
      }

      // when installing globally, or just in global style, we never place
      // deps above the first level.
      if (globalStyle) {
        const rp = target.resolveParent
        if (rp && rp.isProjectRoot) {
          break
        }
      }
    }

    Object.assign(this, {
      canPlace,
      canPlaceSelf,
    })
    this.current = edge.to

    // if we can't find a target, that means that the last place checked,
    // and all the places before it, had a conflict.
    if (!canPlace) {
      // if not forced, or it's our dep, or strictPeerDeps is set, then
      // this is an ERESOLVE error.
      if (!this.conflictOk) {
        return this.failPeerConflict()
      }

      // ok!  we're gonna allow the conflict, but we should still warn
      // if we have a current, then we treat CONFLICT as a KEEP.
      // otherwise, we just skip it.  Only warn on the one that actually
      // could not be placed somewhere.
      if (!canPlaceSelf) {
        this.warnPeerConflict()
        return
      }

      this.canPlace = canPlaceSelf
    }

    // now we have a target, a tree of CanPlaceDep results for the peer group,
    // and we are ready to go
    this.placeInTree()
  }

  placeInTree () {
    const {
      dep,
      canPlace,
      edge,
    } = this

    /* istanbul ignore next */
    if (!canPlace) {
      debug(() => {
        throw new Error('canPlace not set, but trying to place in tree')
      })
      return
    }

    const { target } = canPlace

    log.silly(
      'placeDep',
      target.location || 'ROOT',
      `${dep.name}@${dep.version}`,
      canPlace.description,
      `for: ${this.edge.from.package._id || this.edge.from.location}`,
      `want: ${edge.spec || '*'}`
    )

    const placementType = canPlace.canPlace === CONFLICT
      ? canPlace.canPlaceSelf
      : canPlace.canPlace

    // if we're placing in the tree with --force, we can get here even though
    // it's a conflict.  Treat it as a KEEP, but warn and move on.
    if (placementType === KEEP) {
      // this was a peerConflicted peer dep
      if (edge.peer && !edge.valid) {
        this.warnPeerConflict()
      }

      // if we get a KEEP in a update scenario, then we MAY have something
      // already duplicating this unnecessarily!  For example:
      // ```
      // root (dep: y@1)
      // +-- x (dep: y@1.1)
      // |   +-- y@1.1.0 (replacing with 1.1.2, got KEEP at the root)
      // +-- y@1.1.2 (updated already from 1.0.0)
      // ```
      // Now say we do `reify({update:['y']})`, and the latest version is
      // 1.1.2, which we now have in the root.  We'll try to place y@1.1.2
      // first in x, then in the root, ending with KEEP, because we already
      // have it.  In that case, we ought to REMOVE the nm/x/nm/y node, because
      // it is an unnecessary duplicate.
      this.pruneDedupable(target)
      return
    }

    // we were told to place it here in the target, so either it does not
    // already exist in the tree, OR it's shadowed.
    // handle otherwise unresolvable dependency nesting loops by
    // creating a symbolic link
    // a1 -> b1 -> a2 -> b2 -> a1 -> ...
    // instead of nesting forever, when the loop occurs, create
    // a symbolic link to the earlier instance
    for (let p = target; p; p = p.resolveParent) {
      if (p.matches(dep) && !p.isTop) {
        this.placed = new Link({ parent: target, target: p })
        return
      }
    }

    // XXX if we are replacing SOME of a peer entry group, we will need to
    // remove any that are not being replaced and will now be invalid, and
    // re-evaluate them deeper into the tree.

    const virtualRoot = dep.parent
    this.placed = new dep.constructor({
      name: dep.name,
      pkg: dep.package,
      resolved: dep.resolved,
      integrity: dep.integrity,
      legacyPeerDeps: this.legacyPeerDeps,
      error: dep.errors[0],
      ...(dep.overrides ? { overrides: dep.overrides } : {}),
      ...(dep.isLink ? { target: dep.target, realpath: dep.realpath } : {}),
    })

    this.oldDep = target.children.get(this.name)
    if (this.oldDep) {
      this.replaceOldDep()
    } else {
      this.placed.parent = target
    }

    // if it's a peerConflicted peer dep, warn about it
    if (edge.peer && !this.placed.satisfies(edge)) {
      this.warnPeerConflict()
    }

    // If the edge is not an error, then we're updating something, and
    // MAY end up putting a better/identical node further up the tree in
    // a way that causes an unnecessary duplication.  If so, remove the
    // now-unnecessary node.
    if (edge.valid && edge.to && edge.to !== this.placed) {
      this.pruneDedupable(edge.to, false)
    }

    // in case we just made some duplicates that can be removed,
    // prune anything deeper in the tree that can be replaced by this
    for (const node of target.root.inventory.query('name', this.name)) {
      if (node.isDescendantOf(target) && !node.isTop) {
        this.pruneDedupable(node, false)
        // only walk the direct children of the ones we kept
        if (node.root === target.root) {
          for (const kid of node.children.values()) {
            this.pruneDedupable(kid, false)
          }
        }
      }
    }

    // also place its unmet or invalid peer deps at this location
    // loop through any peer deps from the thing we just placed, and place
    // those ones as well.  it's safe to do this with the virtual nodes,
    // because we're copying rather than moving them out of the virtual root,
    // otherwise they'd be gone and the peer set would change throughout
    // this loop.
    for (const peerEdge of this.placed.edgesOut.values()) {
      if (peerEdge.valid || !peerEdge.peer || peerEdge.peerConflicted) {
        continue
      }

      const peer = virtualRoot.children.get(peerEdge.name)

      // Note: if the virtualRoot *doesn't* have the peer, then that means
      // it's an optional peer dep.  If it's not being properly met (ie,
      // peerEdge.valid is false), then this is likely heading for an
      // ERESOLVE error, unless it can walk further up the tree.
      if (!peer) {
        continue
      }

      // peerConflicted peerEdge, just accept what's there already
      if (!peer.satisfies(peerEdge)) {
        continue
      }

      this.children.push(new PlaceDep({
        parent: this,
        dep: peer,
        node: this.placed,
        edge: peerEdge,
      }))
    }
  }

  replaceOldDep () {
    const target = this.oldDep.parent

    // XXX handle replacing an entire peer group?
    // what about cases where we need to push some other peer groups deeper
    // into the tree?  all the tree updating should be done here, and track
    // all the things that we add and remove, so that we can know what
    // to re-evaluate.

    // if we're replacing, we should also remove any nodes for edges that
    // are now invalid, and where this (or its deps) is the only dependent,
    // and also recurse on that pruning.  Otherwise leaving that dep node
    // around can result in spurious conflicts pushing nodes deeper into
    // the tree than needed in the case of cycles that will be removed
    // later anyway.
    const oldDeps = []
    for (const [name, edge] of this.oldDep.edgesOut.entries()) {
      if (!this.placed.edgesOut.has(name) && edge.to) {
        oldDeps.push(...gatherDepSet([edge.to], e => e.to !== edge.to))
      }
    }

    // gather all peer edgesIn which are at this level, and will not be
    // satisfied by the new dependency.  Those are the peer sets that need
    // to be either warned about (if they cannot go deeper), or removed and
    // re-placed (if they can).
    const prunePeerSets = []
    for (const edge of this.oldDep.edgesIn) {
      if (this.placed.satisfies(edge) ||
          !edge.peer ||
          edge.from.parent !== target ||
          edge.peerConflicted) {
        // not a peer dep, not invalid, or not from this level, so it's fine
        // to just let it re-evaluate as a problemEdge later, or let it be
        // satisfied by the new dep being placed.
        continue
      }
      for (const entryEdge of peerEntrySets(edge.from).keys()) {
        // either this one needs to be pruned and re-evaluated, or marked
        // as peerConflicted and warned about.  If the entryEdge comes in from
        // the root or a workspace, then we have to leave it alone, and in that
        // case, it will have already warned or crashed by getting to this point
        const entryNode = entryEdge.to
        const deepestTarget = deepestNestingTarget(entryNode)
        if (deepestTarget !== target &&
            !(entryEdge.from.isProjectRoot || entryEdge.from.isWorkspace)) {
          prunePeerSets.push(...gatherDepSet([entryNode], e => {
            return e.to !== entryNode && !e.peerConflicted
          }))
        } else {
          this.warnPeerConflict(edge, this.dep)
        }
      }
    }

    this.placed.replace(this.oldDep)
    this.pruneForReplacement(this.placed, oldDeps)
    for (const dep of prunePeerSets) {
      for (const edge of dep.edgesIn) {
        this.needEvaluation.add(edge.from)
      }
      dep.root = null
    }
  }

  pruneForReplacement (node, oldDeps) {
    // gather up all the now-invalid/extraneous edgesOut, as long as they are
    // only depended upon by the old node/deps
    const invalidDeps = new Set([...node.edgesOut.values()]
      .filter(e => e.to && !e.valid).map(e => e.to))
    for (const dep of oldDeps) {
      const set = gatherDepSet([dep], e => e.to !== dep && e.valid)
      for (const dep of set) {
        invalidDeps.add(dep)
      }
    }

    // ignore dependency edges from the node being replaced, but
    // otherwise filter the set down to just the set with no
    // dependencies from outside the set, except the node in question.
    const deps = gatherDepSet(invalidDeps, edge =>
      edge.from !== node && edge.to !== node && edge.valid)

    // now just delete whatever's left, because it's junk
    for (const dep of deps) {
      dep.root = null
    }
  }

  // prune all the nodes in a branch of the tree that can be safely removed
  // This is only the most basic duplication detection; it finds if there
  // is another satisfying node further up the tree, and if so, dedupes.
  // Even in legacyBundling mode, we do this amount of deduplication.
  pruneDedupable (node, descend = true) {
    if (node.canDedupe(this.preferDedupe)) {
      // gather up all deps that have no valid edges in from outside
      // the dep set, except for this node we're deduping, so that we
      // also prune deps that would be made extraneous.
      const deps = gatherDepSet([node], e => e.to !== node && e.valid)
      for (const node of deps) {
        node.root = null
      }
      return
    }
    if (descend) {
      // sort these so that they're deterministically ordered
      // otherwise, resulting tree shape is dependent on the order
      // in which they happened to be resolved.
      const nodeSort = (a, b) => localeCompare(a.location, b.location)

      const children = [...node.children.values()].sort(nodeSort)
      for (const child of children) {
        this.pruneDedupable(child)
      }
      const fsChildren = [...node.fsChildren].sort(nodeSort)
      for (const topNode of fsChildren) {
        const children = [...topNode.children.values()].sort(nodeSort)
        for (const child of children) {
          this.pruneDedupable(child)
        }
      }
    }
  }

  get conflictOk () {
    return this.force || (!this.isMine && !this.strictPeerDeps)
  }

  get isMine () {
    const { edge } = this.top
    const { from: node } = edge

    if (node.isWorkspace || node.isProjectRoot) {
      return true
    }

    if (!edge.peer) {
      return false
    }

    // re-entry case.  check if any non-peer edges come from the project,
    // or any entryEdges on peer groups are from the root.
    let hasPeerEdges = false
    for (const edge of node.edgesIn) {
      if (edge.peer) {
        hasPeerEdges = true
        continue
      }
      if (edge.from.isWorkspace || edge.from.isProjectRoot) {
        return true
      }
    }
    if (hasPeerEdges) {
      for (const edge of peerEntrySets(node).keys()) {
        if (edge.from.isWorkspace || edge.from.isProjectRoot) {
          return true
        }
      }
    }

    return false
  }

  warnPeerConflict (edge, dep) {
    edge = edge || this.edge
    dep = dep || this.dep
    edge.peerConflicted = true
    const expl = this.explainPeerConflict(edge, dep)
    log.warn('ERESOLVE', 'overriding peer dependency', expl)
  }

  failPeerConflict (edge, dep) {
    edge = edge || this.top.edge
    dep = dep || this.top.dep
    const expl = this.explainPeerConflict(edge, dep)
    throw Object.assign(new Error('could not resolve'), expl)
  }

  explainPeerConflict (edge, dep) {
    const { from: node } = edge
    const curNode = node.resolve(edge.name)

    const expl = {
      code: 'ERESOLVE',
      edge: edge.explain(),
      dep: dep.explain(edge),
    }

    if (this.parent) {
      // this is the conflicted peer
      expl.current = curNode && curNode.explain(edge)
      expl.peerConflict = this.current && this.current.explain(this.edge)
    } else {
      expl.current = curNode && curNode.explain()
      if (this.canPlaceSelf && this.canPlaceSelf.canPlaceSelf !== CONFLICT) {
        // failed while checking for a child dep
        const cps = this.canPlaceSelf
        for (const peer of cps.conflictChildren) {
          if (peer.current) {
            expl.peerConflict = {
              current: peer.current.explain(),
              peer: peer.dep.explain(peer.edge),
            }
            break
          }
        }
      } else {
        expl.peerConflict = {
          current: this.current && this.current.explain(),
          peer: this.dep.explain(this.edge),
        }
      }
    }

    const {
      strictPeerDeps,
      force,
      isMine,
    } = this
    Object.assign(expl, {
      strictPeerDeps,
      force,
      isMine,
    })

    // XXX decorate more with this.canPlace and this.canPlaceSelf,
    // this.checks, this.children, walk over conflicted peers, etc.
    return expl
  }

  getStartNode () {
    // if we are a peer, then we MUST be at least as shallow as the
    // peer dependent
    const from = this.parent ? this.parent.getStartNode() : this.edge.from
    return deepestNestingTarget(from, this.name)
  }

  get top () {
    return this.parent ? this.parent.top : this
  }

  isVulnerable (node) {
    return this.auditReport && this.auditReport.isVulnerable(node)
  }

  get allChildren () {
    const set = new Set(this.children)
    for (const child of set) {
      for (const grandchild of child.children) {
        set.add(grandchild)
      }
    }
    return [...set]
  }
}

module.exports = PlaceDep

}, function(modId) { var map = {"./deepest-nesting-target.js":1653046641894,"./can-place-dep.js":1653046641892,"./debug.js":1653046641891,"./link.js":1653046641896,"./gather-dep-set.js":1653046641904,"./peer-entry-sets.js":1653046641893}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641896, function(require, module, exports) {
const debug = require('./debug.js')
const relpath = require('./relpath.js')
const Node = require('./node.js')
const _loadDeps = Symbol.for('Arborist.Node._loadDeps')
const _target = Symbol.for('_target')
const { dirname } = require('path')
// defined by Node class
const _delistFromMeta = Symbol.for('_delistFromMeta')
const _refreshLocation = Symbol.for('_refreshLocation')
class Link extends Node {
  constructor (options) {
    const { root, realpath, target, parent, fsParent } = options

    if (!realpath && !(target && target.path)) {
      throw new TypeError('must provide realpath for Link node')
    }

    super({
      ...options,
      realpath: realpath || target.path,
      root: root || (parent ? parent.root
      : fsParent ? fsParent.root
      : target ? target.root
      : null),
    })

    if (target) {
      this.target = target
    } else if (this.realpath === this.root.path) {
      this.target = this.root
    } else {
      this.target = new Node({
        ...options,
        path: realpath,
        parent: null,
        fsParent: null,
        root: this.root,
      })
    }
  }

  get version () {
    return this.target ? this.target.version : this.package.version || ''
  }

  get target () {
    return this[_target]
  }

  set target (target) {
    const current = this[_target]
    if (target === current) {
      return
    }

    if (current && current.then) {
      debug(() => {
        throw Object.assign(new Error('cannot set target while awaiting'), {
          path: this.path,
          realpath: this.realpath,
        })
      })
    }

    if (target && target.then) {
      // can set to a promise during an async tree build operation
      // wait until then to assign it.
      this[_target] = target
      target.then(node => {
        this[_target] = null
        this.target = node
      })
      return
    }

    if (!target) {
      if (current && current.linksIn) {
        current.linksIn.delete(this)
      }
      if (this.path) {
        this[_delistFromMeta]()
        this[_target] = null
        this.package = {}
        this[_refreshLocation]()
      } else {
        this[_target] = null
      }
      return
    }

    if (!this.path) {
      // temp node pending assignment to a tree
      // we know it's not in the inventory yet, because no path.
      if (target.path) {
        this.realpath = target.path
      } else {
        target.path = target.realpath = this.realpath
      }
      target.root = this.root
      this[_target] = target
      target.linksIn.add(this)
      this.package = target.package
      return
    }

    // have to refresh metadata, because either realpath or package
    // is very likely changing.
    this[_delistFromMeta]()
    this.package = target.package
    this.realpath = target.path
    this[_refreshLocation]()

    target.root = this.root
  }

  // a link always resolves to the relative path to its target
  get resolved () {
    // the path/realpath guard is there for the benefit of setting
    // these things in the "wrong" order
    return this.path && this.realpath
      ? `file:${relpath(dirname(this.path), this.realpath)}`
      : null
  }

  set resolved (r) {}

  // deps are resolved on the target, not the Link
  // so this is a no-op
  [_loadDeps] () {}

  // links can't have children, only their targets can
  // fix it to an empty list so that we can still call
  // things that iterate over them, just as a no-op
  get children () {
    return new Map()
  }

  set children (c) {}

  get isLink () {
    return true
  }
}

module.exports = Link

}, function(modId) { var map = {"./debug.js":1653046641891,"./relpath.js":1653046641897,"./node.js":1653046641898}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641897, function(require, module, exports) {
const { relative } = require('path')
const relpath = (from, to) => relative(from, to).replace(/\\/g, '/')
module.exports = relpath

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641898, function(require, module, exports) {
// inventory, path, realpath, root, and parent
//
// node.root is a reference to the root module in the tree (ie, typically the
// cwd project folder)
//
// node.location is the /-delimited path from the root module to the node.  In
// the case of link targets that may be outside of the root's package tree,
// this can include some number of /../ path segments.  The location of the
// root module is always '.'.  node.location thus never contains drive letters
// or absolute paths, and is portable within a given project, suitable for
// inclusion in lockfiles and metadata.
//
// node.path is the path to the place where this node lives on disk.  It is
// system-specific and absolute.
//
// node.realpath is the path to where the module actually resides on disk.  In
// the case of non-link nodes, node.realpath is equivalent to node.path.  In
// the case of link nodes, it is equivalent to node.target.path.
//
// Setting node.parent will set the node's root to the parent's root, as well
// as updating edgesIn and edgesOut to reload dependency resolutions as needed,
// and setting node.path to parent.path/node_modules/name.
//
// node.inventory is a Map of name to a Set() of all the nodes under a given
// root by that name.  It's empty for non-root nodes, and changing the root
// reference will remove it from the old root's inventory and add it to the new
// one.  This map is useful for cases like `npm update foo` or `npm ls foo`
// where we need to quickly find all instances of a given package name within a
// tree.

const semver = require('semver')
const nameFromFolder = require('@npmcli/name-from-folder')
const Edge = require('./edge.js')
const Inventory = require('./inventory.js')
const OverrideSet = require('./override-set.js')
const { normalize } = require('read-package-json-fast')
const { getPaths: getBinPaths } = require('bin-links')
const npa = require('npm-package-arg')
const debug = require('./debug.js')
const gatherDepSet = require('./gather-dep-set.js')
const treeCheck = require('./tree-check.js')
const walkUp = require('walk-up-path')

const { resolve, relative, dirname, basename } = require('path')
const util = require('util')
const _package = Symbol('_package')
const _parent = Symbol('_parent')
const _target = Symbol.for('_target')
const _fsParent = Symbol('_fsParent')
const _loadDepType = Symbol('_loadDepType')
const _loadWorkspaces = Symbol('_loadWorkspaces')
const _reloadNamedEdges = Symbol('_reloadNamedEdges')
// overridden by Link class
const _loadDeps = Symbol.for('Arborist.Node._loadDeps')
const _root = Symbol('_root')
const _refreshLocation = Symbol.for('_refreshLocation')
const _changePath = Symbol.for('_changePath')
// used by Link class as well
const _delistFromMeta = Symbol.for('_delistFromMeta')
const _global = Symbol.for('global')
const _workspaces = Symbol('_workspaces')
const _explain = Symbol('_explain')
const _explanation = Symbol('_explanation')
const _meta = Symbol('_meta')

const relpath = require('./relpath.js')
const consistentResolve = require('./consistent-resolve.js')

const printableTree = require('./printable.js')
const CaseInsensitiveMap = require('./case-insensitive-map.js')

class Node {
  constructor (options) {
    // NB: path can be null if it's a link target
    const {
      root,
      path,
      realpath,
      parent,
      error,
      meta,
      fsParent,
      resolved,
      integrity,
      // allow setting name explicitly when we haven't set a path yet
      name,
      children,
      fsChildren,
      legacyPeerDeps = false,
      linksIn,
      hasShrinkwrap,
      overrides,
      loadOverrides = false,
      extraneous = true,
      dev = true,
      optional = true,
      devOptional = true,
      peer = true,
      global = false,
      dummy = false,
      sourceReference = null,
    } = options

    // true if part of a global install
    this[_global] = global

    this[_workspaces] = null

    this.errors = error ? [error] : []

    // this will usually be null, except when modeling a
    // package's dependencies in a virtual root.
    this.sourceReference = sourceReference

    const pkg = sourceReference ? sourceReference.package
      : normalize(options.pkg || {})

    this.name = name ||
      nameFromFolder(path || pkg.name || realpath) ||
      pkg.name ||
      null

    // should be equal if not a link
    this.path = path ? resolve(path) : null

    if (!this.name && (!this.path || this.path !== dirname(this.path))) {
      throw new TypeError('could not detect node name from path or package')
    }

    this.realpath = !this.isLink ? this.path : resolve(realpath)

    this.resolved = resolved || null
    if (!this.resolved) {
      // note: this *only* works for non-file: deps, so we avoid even
      // trying here.
      // file: deps are tracked in package.json will _resolved set to the
      // full path to the tarball or link target.  However, if the package
      // is checked into git or moved to another location, that's 100% not
      // portable at all!  The _where and _location don't provide much help,
      // since _location is just where the module ended up in the tree,
      // and _where can be different than the actual root if it's a
      // meta-dep deeper in the dependency graph.
      //
      // If we don't have the other oldest indicators of legacy npm, then it's
      // probably what we're getting from pacote, which IS trustworthy.
      //
      // Otherwise, hopefully a shrinkwrap will help us out.
      const resolved = consistentResolve(pkg._resolved)
      if (resolved && !(/^file:/.test(resolved) && pkg._where)) {
        this.resolved = resolved
      }
    }
    this.integrity = integrity || pkg._integrity || null
    this.hasShrinkwrap = hasShrinkwrap || pkg._hasShrinkwrap || false
    this.legacyPeerDeps = legacyPeerDeps

    this.children = new CaseInsensitiveMap()
    this.fsChildren = new Set()
    this.inventory = new Inventory({})
    this.tops = new Set()
    this.linksIn = new Set(linksIn || [])

    // these three are set by an Arborist taking a catalog
    // after the tree is built.  We don't get this along the way,
    // because they have a tendency to change as new children are
    // added, especially when they're deduped.  Eg, a dev dep may be
    // a 3-levels-deep dependency of a non-dev dep.  If we calc the
    // flags along the way, then they'll tend to be invalid  by the
    // time we need to look at them.
    if (!dummy) {
      this.dev = dev
      this.optional = optional
      this.devOptional = devOptional
      this.peer = peer
      this.extraneous = extraneous
      this.dummy = false
    } else {
      // true if this is a placeholder for the purpose of serving as a
      // fsParent to link targets that get their deps resolved outside
      // the root tree folder.
      this.dummy = true
      this.dev = false
      this.optional = false
      this.devOptional = false
      this.peer = false
      this.extraneous = false
    }

    this.edgesIn = new Set()
    this.edgesOut = new CaseInsensitiveMap()

    // have to set the internal package ref before assigning the parent,
    // because this.package is read when adding to inventory
    this[_package] = pkg && typeof pkg === 'object' ? pkg : {}

    if (overrides) {
      this.overrides = overrides
    } else if (loadOverrides) {
      const overrides = this[_package].overrides || {}
      if (Object.keys(overrides).length > 0) {
        this.overrides = new OverrideSet({
          overrides: this[_package].overrides,
        })
      }
    }

    // only relevant for the root and top nodes
    this.meta = meta

    // Note: this is _slightly_ less efficient for the initial tree
    // building than it could be, but in exchange, it's a much simpler
    // algorithm.
    // If this node has a bunch of children, and those children satisfy
    // its various deps, then we're going to _first_ create all the
    // edges, and _then_ assign the children into place, re-resolving
    // them all in _reloadNamedEdges.
    // A more efficient, but more complicated, approach would be to
    // flag this node as being a part of a tree build, so it could
    // hold off on resolving its deps until its children are in place.

    // call the parent setter
    // Must be set prior to calling _loadDeps, because top-ness is relevant

    // will also assign root if present on the parent
    this[_parent] = null
    this.parent = parent || null

    this[_fsParent] = null
    this.fsParent = fsParent || null

    // see parent/root setters below.
    // root is set to parent's root if we have a parent, otherwise if it's
    // null, then it's set to the node itself.
    if (!parent && !fsParent) {
      this.root = root || null
    }

    // mostly a convenience for testing, but also a way to create
    // trees in a more declarative way than setting parent on each
    if (children) {
      for (const c of children) {
        new Node({ ...c, parent: this })
      }
    }
    if (fsChildren) {
      for (const c of fsChildren) {
        new Node({ ...c, fsParent: this })
      }
    }

    // now load all the dep edges
    this[_loadDeps]()
  }

  get meta () {
    return this[_meta]
  }

  set meta (meta) {
    this[_meta] = meta
    if (meta) {
      meta.add(this)
    }
  }

  get global () {
    return this.root[_global]
  }

  // true for packages installed directly in the global node_modules folder
  get globalTop () {
    return this.global && this.parent && this.parent.isProjectRoot
  }

  get workspaces () {
    return this[_workspaces]
  }

  set workspaces (workspaces) {
    // deletes edges if they already exists
    if (this[_workspaces]) {
      for (const name of this[_workspaces].keys()) {
        if (!workspaces.has(name)) {
          this.edgesOut.get(name).detach()
        }
      }
    }

    this[_workspaces] = workspaces
    this[_loadWorkspaces]()
    this[_loadDeps]()
  }

  get binPaths () {
    if (!this.parent) {
      return []
    }

    return getBinPaths({
      pkg: this[_package],
      path: this.path,
      global: this.global,
      top: this.globalTop,
    })
  }

  get hasInstallScript () {
    const { hasInstallScript, scripts } = this.package
    const { install, preinstall, postinstall } = scripts || {}
    return !!(hasInstallScript || install || preinstall || postinstall)
  }

  get version () {
    return this[_package].version || ''
  }

  get packageName () {
    return this[_package].name || null
  }

  get pkgid () {
    const { name = '', version = '' } = this.package
    // root package will prefer package name over folder name,
    // and never be called an alias.
    const { isProjectRoot } = this
    const myname = isProjectRoot ? name || this.name
      : this.name
    const alias = !isProjectRoot && name && myname !== name ? `npm:${name}@`
      : ''
    return `${myname}@${alias}${version}`
  }

  get package () {
    return this[_package]
  }

  set package (pkg) {
    // just detach them all.  we could make this _slightly_ more efficient
    // by only detaching the ones that changed, but we'd still have to walk
    // them all, and the comparison logic gets a bit tricky.  we generally
    // only do this more than once at the root level, so the resolve() calls
    // are only one level deep, and there's not much to be saved, anyway.
    // simpler to just toss them all out.
    for (const edge of this.edgesOut.values()) {
      edge.detach()
    }

    this[_explanation] = null
    /* istanbul ignore next - should be impossible */
    if (!pkg || typeof pkg !== 'object') {
      debug(() => {
        throw new Error('setting Node.package to non-object')
      })
      pkg = {}
    }
    this[_package] = pkg
    this[_loadWorkspaces]()
    this[_loadDeps]()
    // do a hard reload, since the dependents may now be valid or invalid
    // as a result of the package change.
    this.edgesIn.forEach(edge => edge.reload(true))
  }

  // node.explain(nodes seen already, edge we're trying to satisfy
  // if edge is not specified, it lists every edge into the node.
  explain (edge = null, seen = []) {
    if (this[_explanation]) {
      return this[_explanation]
    }

    return this[_explanation] = this[_explain](edge, seen)
  }

  [_explain] (edge, seen) {
    if (this.isProjectRoot && !this.sourceReference) {
      return {
        location: this.path,
      }
    }

    const why = {
      name: this.isProjectRoot || this.isTop ? this.packageName : this.name,
      version: this.package.version,
    }
    if (this.errors.length || !this.packageName || !this.package.version) {
      why.errors = this.errors.length ? this.errors : [
        new Error('invalid package: lacks name and/or version'),
      ]
      why.package = this.package
    }

    if (this.root.sourceReference) {
      const { name, version } = this.root.package
      why.whileInstalling = {
        name,
        version,
        path: this.root.sourceReference.path,
      }
    }

    if (this.sourceReference) {
      return this.sourceReference.explain(edge, seen)
    }

    if (seen.includes(this)) {
      return why
    }

    why.location = this.location
    why.isWorkspace = this.isWorkspace

    // make a new list each time.  we can revisit, but not loop.
    seen = seen.concat(this)

    why.dependents = []
    if (edge) {
      why.dependents.push(edge.explain(seen))
    } else {
      // ignore invalid edges, since those aren't satisfied by this thing,
      // and are not keeping it held in this spot anyway.
      const edges = []
      for (const edge of this.edgesIn) {
        if (!edge.valid && !edge.from.isProjectRoot) {
          continue
        }

        edges.push(edge)
      }
      for (const edge of edges) {
        why.dependents.push(edge.explain(seen))
      }
    }

    if (this.linksIn.size) {
      why.linksIn = [...this.linksIn].map(link => link[_explain](edge, seen))
    }

    return why
  }

  isDescendantOf (node) {
    for (let p = this; p; p = p.resolveParent) {
      if (p === node) {
        return true
      }
    }
    return false
  }

  getBundler (path = []) {
    // made a cycle, definitely not bundled!
    if (path.includes(this)) {
      return null
    }

    path.push(this)

    const parent = this[_parent]
    if (!parent) {
      return null
    }

    const pBundler = parent.getBundler(path)
    if (pBundler) {
      return pBundler
    }

    const ppkg = parent.package
    const bd = ppkg && ppkg.bundleDependencies
    // explicit bundling
    if (Array.isArray(bd) && bd.includes(this.name)) {
      return parent
    }

    // deps that are deduped up to the bundling level are bundled.
    // however, if they get their dep met further up than that,
    // then they are not bundled.  Ie, installing a package with
    // unmet bundled deps will not cause your deps to be bundled.
    for (const edge of this.edgesIn) {
      const eBundler = edge.from.getBundler(path)
      if (!eBundler) {
        continue
      }

      if (eBundler === parent) {
        return eBundler
      }
    }

    return null
  }

  get inBundle () {
    return !!this.getBundler()
  }

  // when reifying, if a package is technically in a bundleDependencies list,
  // but that list is the root project, we still have to install it.  This
  // getter returns true if it's in a dependency's bundle list, not the root's.
  get inDepBundle () {
    const bundler = this.getBundler()
    return !!bundler && bundler !== this.root
  }

  get isWorkspace () {
    if (this.isProjectRoot) {
      return false
    }
    const { root } = this
    const { type, to } = root.edgesOut.get(this.packageName) || {}
    return type === 'workspace' && to && (to.target === this || to === this)
  }

  get isRoot () {
    return this === this.root
  }

  get isProjectRoot () {
    // only treat as project root if it's the actual link that is the root,
    // or the target of the root link, but NOT if it's another link to the
    // same root that happens to be somewhere else.
    return this === this.root || this === this.root.target
  }

  * ancestry () {
    for (let anc = this; anc; anc = anc.resolveParent) {
      yield anc
    }
  }

  set root (root) {
    // setting to null means this is the new root
    // should only ever be one step
    while (root && root.root !== root) {
      root = root.root
    }

    root = root || this

    // delete from current root inventory
    this[_delistFromMeta]()

    // can't set the root (yet) if there's no way to determine location
    // this allows us to do new Node({...}) and then set the root later.
    // just make the assignment so we don't lose it, and move on.
    if (!this.path || !root.realpath || !root.path) {
      return this[_root] = root
    }

    // temporarily become a root node
    this[_root] = this

    // break all linksIn, we're going to re-set them if needed later
    for (const link of this.linksIn) {
      link[_target] = null
      this.linksIn.delete(link)
    }

    // temporarily break this link as well, we'll re-set if possible later
    const { target } = this
    if (this.isLink) {
      if (target) {
        target.linksIn.delete(this)
        if (target.root === this) {
          target[_delistFromMeta]()
        }
      }
      this[_target] = null
    }

    // if this is part of a cascading root set, then don't do this bit
    // but if the parent/fsParent is in a different set, we have to break
    // that reference before proceeding
    if (this.parent && this.parent.root !== root) {
      this.parent.children.delete(this.name)
      this[_parent] = null
    }
    if (this.fsParent && this.fsParent.root !== root) {
      this.fsParent.fsChildren.delete(this)
      this[_fsParent] = null
    }

    if (root === this) {
      this[_refreshLocation]()
    } else {
      // setting to some different node.
      const loc = relpath(root.realpath, this.path)
      const current = root.inventory.get(loc)

      // clobber whatever is there now
      if (current) {
        current.root = null
      }

      this[_root] = root
      // set this.location and add to inventory
      this[_refreshLocation]()

      // try to find our parent/fsParent in the new root inventory
      for (const p of walkUp(dirname(this.path))) {
        if (p === this.path) {
          continue
        }
        const ploc = relpath(root.realpath, p)
        const parent = root.inventory.get(ploc)
        if (parent) {
          /* istanbul ignore next - impossible */
          if (parent.isLink) {
            debug(() => {
              throw Object.assign(new Error('assigning parentage to link'), {
                path: this.path,
                parent: parent.path,
                parentReal: parent.realpath,
              })
            })
            continue
          }
          const childLoc = `${ploc}${ploc ? '/' : ''}node_modules/${this.name}`
          const isParent = this.location === childLoc
          if (isParent) {
            const oldChild = parent.children.get(this.name)
            if (oldChild && oldChild !== this) {
              oldChild.root = null
            }
            if (this.parent) {
              this.parent.children.delete(this.name)
              this.parent[_reloadNamedEdges](this.name)
            }
            parent.children.set(this.name, this)
            this[_parent] = parent
            // don't do it for links, because they don't have a target yet
            // we'll hit them up a bit later on.
            if (!this.isLink) {
              parent[_reloadNamedEdges](this.name)
            }
          } else {
            /* istanbul ignore if - should be impossible, since we break
             * all fsParent/child relationships when moving? */
            if (this.fsParent) {
              this.fsParent.fsChildren.delete(this)
            }
            parent.fsChildren.add(this)
            this[_fsParent] = parent
          }
          break
        }
      }

      // if it doesn't have a parent, it's a top node
      if (!this.parent) {
        root.tops.add(this)
      } else {
        root.tops.delete(this)
      }

      // assign parentage for any nodes that need to have this as a parent
      // this can happen when we have a node at nm/a/nm/b added *before*
      // the node at nm/a, which might have the root node as a fsParent.
      // we can't rely on the public setter here, because it calls into
      // this function to set up these references!
      const nmloc = `${this.location}${this.location ? '/' : ''}node_modules/`
      const isChild = n => n.location === nmloc + n.name
      // check dirname so that /foo isn't treated as the fsparent of /foo-bar
      const isFsChild = n => {
        return dirname(n.path).startsWith(this.path) &&
          n !== this &&
          !n.parent &&
          (!n.fsParent ||
            n.fsParent === this ||
            dirname(this.path).startsWith(n.fsParent.path))
      }
      const isKid = n => isChild(n) || isFsChild(n)

      // only walk top nodes, since anything else already has a parent.
      for (const child of root.tops) {
        if (!isKid(child)) {
          continue
        }

        // set up the internal parentage links
        if (this.isLink) {
          child.root = null
        } else {
          // can't possibly have a parent, because it's in tops
          if (child.fsParent) {
            child.fsParent.fsChildren.delete(child)
          }
          child[_fsParent] = null
          if (isChild(child)) {
            this.children.set(child.name, child)
            child[_parent] = this
            root.tops.delete(child)
          } else {
            this.fsChildren.add(child)
            child[_fsParent] = this
          }
        }
      }

      // look for any nodes with the same realpath.  either they're links
      // to that realpath, or a thing at that realpath if we're adding a link
      // (if we're adding a regular node, we already deleted the old one)
      for (const node of root.inventory.query('realpath', this.realpath)) {
        if (node === this) {
          continue
        }

        /* istanbul ignore next - should be impossible */
        debug(() => {
          if (node.root !== root) {
            throw new Error('inventory contains node from other root')
          }
        })

        if (this.isLink) {
          const target = node.target
          this[_target] = target
          this[_package] = target.package
          target.linksIn.add(this)
          // reload edges here, because now we have a target
          if (this.parent) {
            this.parent[_reloadNamedEdges](this.name)
          }
          break
        } else {
          /* istanbul ignore else - should be impossible */
          if (node.isLink) {
            node[_target] = this
            node[_package] = this.package
            this.linksIn.add(node)
            if (node.parent) {
              node.parent[_reloadNamedEdges](node.name)
            }
          } else {
            debug(() => {
              throw Object.assign(new Error('duplicate node in root setter'), {
                path: this.path,
                realpath: this.realpath,
                root: root.realpath,
              })
            })
          }
        }
      }
    }

    // reload all edgesIn where the root doesn't match, so we don't have
    // cross-tree dependency graphs
    for (const edge of this.edgesIn) {
      if (edge.from.root !== root) {
        edge.reload()
      }
    }
    // reload all edgesOut where root doens't match, or is missing, since
    // it might not be missing in the new tree
    for (const edge of this.edgesOut.values()) {
      if (!edge.to || edge.to.root !== root) {
        edge.reload()
      }
    }

    // now make sure our family comes along for the ride!
    const family = new Set([
      ...this.fsChildren,
      ...this.children.values(),
      ...this.inventory.values(),
    ].filter(n => n !== this))

    for (const child of family) {
      if (child.root !== root) {
        child[_delistFromMeta]()
        child[_parent] = null
        this.children.delete(child.name)
        child[_fsParent] = null
        this.fsChildren.delete(child)
        for (const l of child.linksIn) {
          l[_target] = null
          child.linksIn.delete(l)
        }
      }
    }
    for (const child of family) {
      if (child.root !== root) {
        child.root = root
      }
    }

    // if we had a target, and didn't find one in the new root, then bring
    // it over as well, but only if we're setting the link into a new root,
    // as we don't want to lose the target any time we remove a link.
    if (this.isLink && target && !this.target && root !== this) {
      target.root = root
    }

    // tree should always be valid upon root setter completion.
    treeCheck(this)
    treeCheck(root)
  }

  get root () {
    return this[_root] || this
  }

  [_loadWorkspaces] () {
    if (!this[_workspaces]) {
      return
    }

    for (const [name, path] of this[_workspaces].entries()) {
      new Edge({ from: this, name, spec: `file:${path}`, type: 'workspace' })
    }
  }

  [_loadDeps] () {
    // Caveat!  Order is relevant!
    // Packages in optionalDependencies are optional.
    // Packages in both deps and devDeps are required.
    // Note the subtle breaking change from v6: it is no longer possible
    // to have a different spec for a devDep than production dep.

    // Linked targets that are disconnected from the tree are tops,
    // but don't have a 'path' field, only a 'realpath', because we
    // don't know their canonical location. We don't need their devDeps.
    const pd = this.package.peerDependencies
    if (pd && typeof pd === 'object' && !this.legacyPeerDeps) {
      const pm = this.package.peerDependenciesMeta || {}
      const peerDependencies = {}
      const peerOptional = {}
      for (const [name, dep] of Object.entries(pd)) {
        if (pm[name] && pm[name].optional) {
          peerOptional[name] = dep
        } else {
          peerDependencies[name] = dep
        }
      }
      this[_loadDepType](peerDependencies, 'peer')
      this[_loadDepType](peerOptional, 'peerOptional')
    }

    this[_loadDepType](this.package.dependencies, 'prod')
    this[_loadDepType](this.package.optionalDependencies, 'optional')

    const { globalTop, isTop, path, sourceReference } = this
    const {
      globalTop: srcGlobalTop,
      isTop: srcTop,
      path: srcPath,
    } = sourceReference || {}
    const thisDev = isTop && !globalTop && path
    const srcDev = !sourceReference || srcTop && !srcGlobalTop && srcPath
    if (thisDev && srcDev) {
      this[_loadDepType](this.package.devDependencies, 'dev')
    }
  }

  [_loadDepType] (deps, type) {
    const ad = this.package.acceptDependencies || {}
    // Because of the order in which _loadDeps runs, we always want to
    // prioritize a new edge over an existing one
    for (const [name, spec] of Object.entries(deps || {})) {
      const current = this.edgesOut.get(name)
      if (!current || current.type !== 'workspace') {
        new Edge({ from: this, name, spec, accept: ad[name], type })
      }
    }
  }

  get fsParent () {
    const parent = this[_fsParent]
    /* istanbul ignore next - should be impossible */
    debug(() => {
      if (parent === this) {
        throw new Error('node set to its own fsParent')
      }
    })
    return parent
  }

  set fsParent (fsParent) {
    if (!fsParent) {
      if (this[_fsParent]) {
        this.root = null
      }
      return
    }

    debug(() => {
      if (fsParent === this) {
        throw new Error('setting node to its own fsParent')
      }

      if (fsParent.realpath === this.realpath) {
        throw new Error('setting fsParent to same path')
      }

      // the initial set MUST be an actual walk-up from the realpath
      // subsequent sets will re-root on the new fsParent's path.
      if (!this[_fsParent] && this.realpath.indexOf(fsParent.realpath) !== 0) {
        throw Object.assign(new Error('setting fsParent improperly'), {
          path: this.path,
          realpath: this.realpath,
          fsParent: {
            path: fsParent.path,
            realpath: fsParent.realpath,
          },
        })
      }
    })

    if (fsParent.isLink) {
      fsParent = fsParent.target
    }

    // setting a thing to its own fsParent is not normal, but no-op for safety
    if (this === fsParent || fsParent.realpath === this.realpath) {
      return
    }

    // nothing to do
    if (this[_fsParent] === fsParent) {
      return
    }

    const oldFsParent = this[_fsParent]
    const newPath = !oldFsParent ? this.path
      : resolve(fsParent.path, relative(oldFsParent.path, this.path))
    const nmPath = resolve(fsParent.path, 'node_modules', this.name)

    // this is actually the parent, set that instead
    if (newPath === nmPath) {
      this.parent = fsParent
      return
    }

    const pathChange = newPath !== this.path

    // remove from old parent/fsParent
    const oldParent = this.parent
    const oldName = this.name
    if (this.parent) {
      this.parent.children.delete(this.name)
      this[_parent] = null
    }
    if (this.fsParent) {
      this.fsParent.fsChildren.delete(this)
      this[_fsParent] = null
    }

    // update this.path/realpath for this and all children/fsChildren
    if (pathChange) {
      this[_changePath](newPath)
    }

    if (oldParent) {
      oldParent[_reloadNamedEdges](oldName)
    }

    // clobbers anything at that path, resets all appropriate references
    this.root = fsParent.root
  }

  // is it safe to replace one node with another?  check the edges to
  // make sure no one will get upset.  Note that the node might end up
  // having its own unmet dependencies, if the new node has new deps.
  // Note that there are cases where Arborist will opt to insert a node
  // into the tree even though this function returns false!  This is
  // necessary when a root dependency is added or updated, or when a
  // root dependency brings peer deps along with it.  In that case, we
  // will go ahead and create the invalid state, and then try to resolve
  // it with more tree construction, because it's a user request.
  canReplaceWith (node, ignorePeers = []) {
    if (node.name !== this.name) {
      return false
    }

    if (node.packageName !== this.packageName) {
      return false
    }

    // XXX need to check for two root nodes?
    if (node.overrides !== this.overrides) {
      return false
    }

    ignorePeers = new Set(ignorePeers)

    // gather up all the deps of this node and that are only depended
    // upon by deps of this node.  those ones don't count, since
    // they'll be replaced if this node is replaced anyway.
    const depSet = gatherDepSet([this], e => e.to !== this && e.valid)

    for (const edge of this.edgesIn) {
      // when replacing peer sets, we need to be able to replace the entire
      // peer group, which means we ignore incoming edges from other peers
      // within the replacement set.
      const ignored = !this.isTop &&
        edge.from.parent === this.parent &&
        edge.peer &&
        ignorePeers.has(edge.from.name)
      if (ignored) {
        continue
      }

      // only care about edges that don't originate from this node
      if (!depSet.has(edge.from) && !edge.satisfiedBy(node)) {
        return false
      }
    }

    return true
  }

  canReplace (node, ignorePeers) {
    return node.canReplaceWith(this, ignorePeers)
  }

  // return true if it's safe to remove this node, because anything that
  // is depending on it would be fine with the thing that they would resolve
  // to if it was removed, or nothing is depending on it in the first place.
  canDedupe (preferDedupe = false) {
    // not allowed to mess with shrinkwraps or bundles
    if (this.inDepBundle || this.inShrinkwrap) {
      return false
    }

    // it's a top level pkg, or a dep of one
    if (!this.resolveParent || !this.resolveParent.resolveParent) {
      return false
    }

    // no one wants it, remove it
    if (this.edgesIn.size === 0) {
      return true
    }

    const other = this.resolveParent.resolveParent.resolve(this.name)

    // nothing else, need this one
    if (!other) {
      return false
    }

    // if it's the same thing, then always fine to remove
    if (other.matches(this)) {
      return true
    }

    // if the other thing can't replace this, then skip it
    if (!other.canReplace(this)) {
      return false
    }

    // if we prefer dedupe, or if the version is greater/equal, take the other
    if (preferDedupe || semver.gte(other.version, this.version)) {
      return true
    }

    return false
  }

  satisfies (requested) {
    if (requested instanceof Edge) {
      return this.name === requested.name && requested.satisfiedBy(this)
    }

    const parsed = npa(requested)
    const { name = this.name, rawSpec: spec } = parsed
    return this.name === name && this.satisfies(new Edge({
      from: new Node({ path: this.root.realpath }),
      type: 'prod',
      name,
      spec,
    }))
  }

  matches (node) {
    // if the nodes are literally the same object, obviously a match.
    if (node === this) {
      return true
    }

    // if the names don't match, they're different things, even if
    // the package contents are identical.
    if (node.name !== this.name) {
      return false
    }

    // if they're links, they match if the targets match
    if (this.isLink) {
      return node.isLink && this.target.matches(node.target)
    }

    // if they're two project root nodes, they're different if the paths differ
    if (this.isProjectRoot && node.isProjectRoot) {
      return this.path === node.path
    }

    // if the integrity matches, then they're the same.
    if (this.integrity && node.integrity) {
      return this.integrity === node.integrity
    }

    // if no integrity, check resolved
    if (this.resolved && node.resolved) {
      return this.resolved === node.resolved
    }

    // if no resolved, check both package name and version
    // otherwise, conclude that they are different things
    return this.packageName && node.packageName &&
      this.packageName === node.packageName &&
      this.version && node.version &&
      this.version === node.version
  }

  // replace this node with the supplied argument
  // Useful when mutating an ideal tree, so we can avoid having to call
  // the parent/root setters more than necessary.
  replaceWith (node) {
    node.replace(this)
  }

  replace (node) {
    this[_delistFromMeta]()

    // if the name matches, but is not identical, we are intending to clobber
    // something case-insensitively, so merely setting name and path won't
    // have the desired effect.  just set the path so it'll collide in the
    // parent's children map, and leave it at that.
    const nameMatch = node.parent &&
      node.parent.children.get(this.name) === node
    if (nameMatch) {
      this.path = resolve(node.parent.path, 'node_modules', this.name)
    } else {
      this.path = node.path
      this.name = node.name
    }

    if (!this.isLink) {
      this.realpath = this.path
    }
    this[_refreshLocation]()

    // keep children when a node replaces another
    if (!this.isLink) {
      for (const kid of node.children.values()) {
        kid.parent = this
      }
    }

    if (!node.isRoot) {
      this.root = node.root
    }

    treeCheck(this)
  }

  get inShrinkwrap () {
    return this.parent &&
      (this.parent.hasShrinkwrap || this.parent.inShrinkwrap)
  }

  get parent () {
    const parent = this[_parent]
    /* istanbul ignore next - should be impossible */
    debug(() => {
      if (parent === this) {
        throw new Error('node set to its own parent')
      }
    })
    return parent
  }

  // This setter keeps everything in order when we move a node from
  // one point in a logical tree to another.  Edges get reloaded,
  // metadata updated, etc.  It's also called when we *replace* a node
  // with another by the same name (eg, to update or dedupe).
  // This does a couple of walks out on the node_modules tree, recursing
  // into child nodes.  However, as setting the parent is typically done
  // with nodes that don't have have many children, and (deduped) package
  // trees tend to be broad rather than deep, it's not that bad.
  // The only walk that starts from the parent rather than this node is
  // limited by edge name.
  set parent (parent) {
    // when setting to null, just remove it from the tree entirely
    if (!parent) {
      // but only delete it if we actually had a parent in the first place
      // otherwise it's just setting to null when it's already null
      if (this[_parent]) {
        this.root = null
      }
      return
    }

    if (parent.isLink) {
      parent = parent.target
    }

    // setting a thing to its own parent is not normal, but no-op for safety
    if (this === parent) {
      return
    }

    const oldParent = this[_parent]

    // nothing to do
    if (oldParent === parent) {
      return
    }

    // ok now we know something is actually changing, and parent is not a link
    const newPath = resolve(parent.path, 'node_modules', this.name)
    const pathChange = newPath !== this.path

    // remove from old parent/fsParent
    if (oldParent) {
      oldParent.children.delete(this.name)
      this[_parent] = null
    }
    if (this.fsParent) {
      this.fsParent.fsChildren.delete(this)
      this[_fsParent] = null
    }

    // update this.path/realpath for this and all children/fsChildren
    if (pathChange) {
      this[_changePath](newPath)
    }

    if (parent.overrides) {
      this.overrides = parent.overrides.getNodeRule(this)
    }

    // clobbers anything at that path, resets all appropriate references
    this.root = parent.root
  }

  // Call this before changing path or updating the _root reference.
  // Removes the node from its root the metadata and inventory.
  [_delistFromMeta] () {
    const root = this.root
    if (!root.realpath || !this.path) {
      return
    }
    root.inventory.delete(this)
    root.tops.delete(this)
    if (root.meta) {
      root.meta.delete(this.path)
    }
    /* istanbul ignore next - should be impossible */
    debug(() => {
      if ([...root.inventory.values()].includes(this)) {
        throw new Error('failed to delist')
      }
    })
  }

  // update this.path/realpath and the paths of all children/fsChildren
  [_changePath] (newPath) {
    // have to de-list before changing paths
    this[_delistFromMeta]()
    const oldPath = this.path
    this.path = newPath
    const namePattern = /(?:^|\/|\\)node_modules[\\/](@[^/\\]+[\\/][^\\/]+|[^\\/]+)$/
    const nameChange = newPath.match(namePattern)
    if (nameChange && this.name !== nameChange[1]) {
      this.name = nameChange[1].replace(/\\/g, '/')
    }

    // if we move a link target, update link realpaths
    if (!this.isLink) {
      this.realpath = newPath
      for (const link of this.linksIn) {
        link[_delistFromMeta]()
        link.realpath = newPath
        link[_refreshLocation]()
      }
    }
    // if we move /x to /y, then a module at /x/a/b becomes /y/a/b
    for (const child of this.fsChildren) {
      child[_changePath](resolve(newPath, relative(oldPath, child.path)))
    }
    for (const [name, child] of this.children.entries()) {
      child[_changePath](resolve(newPath, 'node_modules', name))
    }

    this[_refreshLocation]()
  }

  // Called whenever the root/parent is changed.
  // NB: need to remove from former root's meta/inventory and then update
  // this.path BEFORE calling this method!
  [_refreshLocation] () {
    const root = this.root
    const loc = relpath(root.realpath, this.path)

    this.location = loc

    root.inventory.add(this)
    if (root.meta) {
      root.meta.add(this)
    }
  }

  assertRootOverrides () {
    if (!this.isProjectRoot || !this.overrides) {
      return
    }

    for (const edge of this.edgesOut.values()) {
      // if these differ an override has been applied, those are not allowed
      // for top level dependencies so throw an error
      if (edge.spec !== edge.rawSpec && !edge.spec.startsWith('$')) {
        throw Object.assign(new Error(`Override for ${edge.name}@${edge.rawSpec} conflicts with direct dependency`), { code: 'EOVERRIDE' })
      }
    }
  }

  addEdgeOut (edge) {
    if (this.overrides) {
      edge.overrides = this.overrides.getEdgeRule(edge)
    }

    this.edgesOut.set(edge.name, edge)
  }

  addEdgeIn (edge) {
    if (edge.overrides) {
      this.overrides = edge.overrides
    }

    this.edgesIn.add(edge)

    // try to get metadata from the yarn.lock file
    if (this.root.meta) {
      this.root.meta.addEdge(edge)
    }
  }

  [_reloadNamedEdges] (name, rootLoc = this.location) {
    const edge = this.edgesOut.get(name)
    // if we don't have an edge, do nothing, but keep descending
    const rootLocResolved = edge && edge.to &&
      edge.to.location === `${rootLoc}/node_modules/${edge.name}`
    const sameResolved = edge && this.resolve(name) === edge.to
    const recheck = rootLocResolved || !sameResolved
    if (edge && recheck) {
      edge.reload(true)
    }
    for (const c of this.children.values()) {
      c[_reloadNamedEdges](name, rootLoc)
    }

    for (const c of this.fsChildren) {
      c[_reloadNamedEdges](name, rootLoc)
    }
  }

  get isLink () {
    return false
  }

  get target () {
    return this
  }

  set target (n) {
    debug(() => {
      throw Object.assign(new Error('cannot set target on non-Link Nodes'), {
        path: this.path,
      })
    })
  }

  get depth () {
    return this.isTop ? 0 : this.parent.depth + 1
  }

  get isTop () {
    return !this.parent || this.globalTop
  }

  get top () {
    return this.isTop ? this : this.parent.top
  }

  get isFsTop () {
    return !this.fsParent
  }

  get fsTop () {
    return this.isFsTop ? this : this.fsParent.fsTop
  }

  get resolveParent () {
    return this.parent || this.fsParent
  }

  resolve (name) {
    /* istanbul ignore next - should be impossible,
     * but I keep doing this mistake in tests */
    debug(() => {
      if (typeof name !== 'string' || !name) {
        throw new Error('non-string passed to Node.resolve')
      }
    })
    const mine = this.children.get(name)
    if (mine) {
      return mine
    }
    const resolveParent = this.resolveParent
    if (resolveParent) {
      return resolveParent.resolve(name)
    }
    return null
  }

  inNodeModules () {
    const rp = this.realpath
    const name = this.name
    const scoped = name.charAt(0) === '@'
    const d = dirname(rp)
    const nm = scoped ? dirname(d) : d
    const dir = dirname(nm)
    const base = scoped ? `${basename(d)}/${basename(rp)}` : basename(rp)
    return base === name && basename(nm) === 'node_modules' ? dir : false
  }

  toJSON () {
    return printableTree(this)
  }

  [util.inspect.custom] () {
    return this.toJSON()
  }
}

module.exports = Node

}, function(modId) { var map = {"./edge.js":1653046641899,"./inventory.js":1653046641902,"./override-set.js":1653046641903,"./debug.js":1653046641891,"./gather-dep-set.js":1653046641904,"./tree-check.js":1653046641890,"./relpath.js":1653046641897,"./consistent-resolve.js":1653046641905,"./printable.js":1653046641906,"./case-insensitive-map.js":1653046641907}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641899, function(require, module, exports) {
// An edge in the dependency graph
// Represents a dependency relationship of some kind

const util = require('util')
const npa = require('npm-package-arg')
const depValid = require('./dep-valid.js')
const _from = Symbol('_from')
const _to = Symbol('_to')
const _type = Symbol('_type')
const _spec = Symbol('_spec')
const _accept = Symbol('_accept')
const _name = Symbol('_name')
const _error = Symbol('_error')
const _loadError = Symbol('_loadError')
const _setFrom = Symbol('_setFrom')
const _explain = Symbol('_explain')
const _explanation = Symbol('_explanation')

const types = new Set([
  'prod',
  'dev',
  'optional',
  'peer',
  'peerOptional',
  'workspace',
])

class ArboristEdge {}
const printableEdge = (edge) => {
  const edgeFrom = edge.from && edge.from.location
  const edgeTo = edge.to && edge.to.location
  const override = edge.overrides && edge.overrides.value

  return Object.assign(new ArboristEdge(), {
    name: edge.name,
    spec: edge.spec,
    type: edge.type,
    ...(edgeFrom != null ? { from: edgeFrom } : {}),
    ...(edgeTo ? { to: edgeTo } : {}),
    ...(edge.error ? { error: edge.error } : {}),
    ...(edge.peerConflicted ? { peerConflicted: true } : {}),
    ...(override ? { overridden: override } : {}),
  })
}

class Edge {
  constructor (options) {
    const { type, name, spec, accept, from, overrides } = options

    if (typeof spec !== 'string') {
      throw new TypeError('must provide string spec')
    }

    if (type === 'workspace' && npa(spec).type !== 'directory') {
      throw new TypeError('workspace edges must be a symlink')
    }

    this[_spec] = spec

    if (overrides !== undefined) {
      this.overrides = overrides
    }

    if (accept !== undefined) {
      if (typeof accept !== 'string') {
        throw new TypeError('accept field must be a string if provided')
      }
      this[_accept] = accept || '*'
    }

    if (typeof name !== 'string') {
      throw new TypeError('must provide dependency name')
    }
    this[_name] = name

    if (!types.has(type)) {
      throw new TypeError(
        `invalid type: ${type}\n` +
        `(valid types are: ${Edge.types.join(', ')})`)
    }
    this[_type] = type
    if (!from) {
      throw new TypeError('must provide "from" node')
    }
    this[_setFrom](from)
    this[_error] = this[_loadError]()
    this.peerConflicted = false
  }

  satisfiedBy (node) {
    if (node.name !== this.name) {
      return false
    }

    return depValid(node, this.spec, this.accept, this.from)
  }

  explain (seen = []) {
    if (this[_explanation]) {
      return this[_explanation]
    }

    return this[_explanation] = this[_explain](seen)
  }

  // return the edge data, and an explanation of how that edge came to be here
  [_explain] (seen) {
    const { error, from, bundled } = this
    return {
      type: this.type,
      name: this.name,
      spec: this.spec,
      ...(this.rawSpec !== this.spec ? {
        rawSpec: this.rawSpec,
        overridden: true,
      } : {}),
      ...(bundled ? { bundled } : {}),
      ...(error ? { error } : {}),
      ...(from ? { from: from.explain(null, seen) } : {}),
    }
  }

  get bundled () {
    if (!this.from) {
      return false
    }
    const { package: { bundleDependencies = [] } } = this.from
    return bundleDependencies.includes(this.name)
  }

  get workspace () {
    return this[_type] === 'workspace'
  }

  get prod () {
    return this[_type] === 'prod'
  }

  get dev () {
    return this[_type] === 'dev'
  }

  get optional () {
    return this[_type] === 'optional' || this[_type] === 'peerOptional'
  }

  get peer () {
    return this[_type] === 'peer' || this[_type] === 'peerOptional'
  }

  get type () {
    return this[_type]
  }

  get name () {
    return this[_name]
  }

  get rawSpec () {
    return this[_spec]
  }

  get spec () {
    if (this.overrides && this.overrides.value && this.overrides.name === this.name) {
      if (this.overrides.value.startsWith('$')) {
        const ref = this.overrides.value.slice(1)
        const pkg = this.from.root.package
        const overrideSpec = (pkg.devDependencies && pkg.devDependencies[ref]) ||
            (pkg.optionalDependencies && pkg.optionalDependencies[ref]) ||
            (pkg.dependencies && pkg.dependencies[ref]) ||
            (pkg.peerDependencies && pkg.peerDependencies[ref])

        if (overrideSpec) {
          return overrideSpec
        }

        throw new Error(`Unable to resolve reference ${this.overrides.value}`)
      }
      return this.overrides.value
    }
    return this[_spec]
  }

  get accept () {
    return this[_accept]
  }

  get valid () {
    return !this.error
  }

  get missing () {
    return this.error === 'MISSING'
  }

  get invalid () {
    return this.error === 'INVALID'
  }

  get peerLocal () {
    return this.error === 'PEER LOCAL'
  }

  get error () {
    this[_error] = this[_error] || this[_loadError]()
    return this[_error] === 'OK' ? null : this[_error]
  }

  [_loadError] () {
    return !this[_to] ? (this.optional ? null : 'MISSING')
      : this.peer && this.from === this.to.parent && !this.from.isTop ? 'PEER LOCAL'
      : !this.satisfiedBy(this.to) ? 'INVALID'
      : 'OK'
  }

  reload (hard = false) {
    this[_explanation] = null
    const newTo = this[_from].resolve(this.name)
    if (newTo !== this[_to]) {
      if (this[_to]) {
        this[_to].edgesIn.delete(this)
      }
      this[_to] = newTo
      this[_error] = this[_loadError]()
      if (this[_to]) {
        this[_to].addEdgeIn(this)
      }
    } else if (hard) {
      this[_error] = this[_loadError]()
    }
  }

  detach () {
    this[_explanation] = null
    if (this[_to]) {
      this[_to].edgesIn.delete(this)
    }
    this[_from].edgesOut.delete(this.name)
    this[_to] = null
    this[_error] = 'DETACHED'
    this[_from] = null
  }

  [_setFrom] (node) {
    this[_explanation] = null
    this[_from] = node
    if (node.edgesOut.has(this.name)) {
      node.edgesOut.get(this.name).detach()
    }

    node.addEdgeOut(this)
    this.reload()
  }

  get from () {
    return this[_from]
  }

  get to () {
    return this[_to]
  }

  toJSON () {
    return printableEdge(this)
  }

  [util.inspect.custom] () {
    return this.toJSON()
  }
}

Edge.types = [...types]
Edge.errors = [
  'DETACHED',
  'MISSING',
  'PEER LOCAL',
  'INVALID',
]

module.exports = Edge

}, function(modId) { var map = {"./dep-valid.js":1653046641900}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641900, function(require, module, exports) {
// Do not rely on package._fields, so that we don't throw
// false failures if a tree is generated by other clients.
// Only relies on child.resolved, which MAY come from
// client-specific package.json meta _fields, but most of
// the time will be pulled out of a lockfile

const semver = require('semver')
const npa = require('npm-package-arg')
const { relative } = require('path')
const fromPath = require('./from-path.js')

const depValid = (child, requested, requestor) => {
  // NB: we don't do much to verify 'tag' type requests.
  // Just verify that we got a remote resolution.  Presumably, it
  // came from a registry and was tagged at some point.

  if (typeof requested === 'string') {
    try {
      // tarball/dir must have resolved to the same tgz on disk, but for
      // file: deps that depend on other files/dirs, we must resolve the
      // location based on the *requestor* file/dir, not where it ends up.
      // '' is equivalent to '*'
      requested = npa.resolve(child.name, requested || '*', fromPath(requestor))
    } catch (er) {
      // Not invalid because the child doesn't match, but because
      // the spec itself is not supported.  Nothing would match,
      // so the edge is definitely not valid and never can be.
      er.dependency = child.name
      er.requested = requested
      requestor.errors.push(er)
      return false
    }
  }

  // if the lockfile is super old, or hand-modified,
  // then it's possible to hit this state.
  if (!requested) {
    const er = new Error('Invalid dependency specifier')
    er.dependency = child.name
    er.requested = requested
    requestor.errors.push(er)
    return false
  }

  switch (requested.type) {
    case 'range':
      if (requested.fetchSpec === '*') {
        return true
      }
      // fallthrough
    case 'version':
      // if it's a version or a range other than '*', semver it
      return semver.satisfies(child.version, requested.fetchSpec, true)

    case 'directory':
      // directory must be a link to the specified folder
      return !!child.isLink &&
        relative(child.realpath, requested.fetchSpec) === ''

    case 'file':
      return tarballValid(child, requested, requestor)

    case 'alias':
      // check that the alias target is valid
      return depValid(child, requested.subSpec, requestor)

    case 'tag':
      // if it's a tag, we just verify that it has a tarball resolution
      // presumably, it came from the registry and was tagged at some point
      return child.resolved && npa(child.resolved).type === 'remote'

    case 'remote':
      // verify that we got it from the desired location
      return child.resolved === requested.fetchSpec

    case 'git': {
      // if it's a git type, verify that they're the same repo
      //
      // if it specifies a definite commit, then it must have the
      // same commit to be considered the same repo
      //
      // if it has a #semver:<range> specifier, verify that the
      // version in the package is in the semver range
      const resRepo = npa(child.resolved || '')
      const resHost = resRepo.hosted
      const reqHost = requested.hosted
      const reqCommit = /^[a-fA-F0-9]{40}$/.test(requested.gitCommittish || '')
      const nc = { noCommittish: !reqCommit }
      const sameRepo =
        resHost ? reqHost && reqHost.ssh(nc) === resHost.ssh(nc)
        : resRepo.fetchSpec === requested.fetchSpec

      return !sameRepo ? false
        : !requested.gitRange ? true
        : semver.satisfies(child.package.version, requested.gitRange, {
          loose: true,
        })
    }

    default: // unpossible, just being cautious
      break
  }

  const er = new Error('Unsupported dependency type')
  er.dependency = child.name
  er.requested = requested
  requestor.errors.push(er)
  return false
}

const tarballValid = (child, requested, requestor) => {
  if (child.isLink) {
    return false
  }

  if (child.resolved) {
    return child.resolved.replace(/\\/g, '/') === `file:${requested.fetchSpec.replace(/\\/g, '/')}`
  }

  // if we have a legacy mutated package.json file.  we can't be 100%
  // sure that it resolved to the same file, but if it was the same
  // request, that's a pretty good indicator of sameness.
  if (child.package._requested) {
    return child.package._requested.saveSpec === requested.saveSpec
  }

  // ok, we're probably dealing with some legacy cruft here, not much
  // we can do at this point unfortunately.
  return false
}

module.exports = (child, requested, accept, requestor) =>
  depValid(child, requested, requestor) ||
  (typeof accept === 'string' ? depValid(child, accept, requestor) : false)

}, function(modId) { var map = {"./from-path.js":1653046641901}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641901, function(require, module, exports) {
// file dependencies need their dependencies resolved based on the
// location where the tarball was found, not the location where they
// end up getting installed.  directory (ie, symlink) deps also need
// to be resolved based on their targets, but that's what realpath is

const { dirname } = require('path')
const npa = require('npm-package-arg')

const fromPath = (node, spec) =>
  spec && spec.type === 'file' ? dirname(spec.fetchSpec)
  : node.realpath

module.exports = node => fromPath(node, node.resolved && npa(node.resolved))

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641902, function(require, module, exports) {
// a class to manage an inventory and set of indexes of
// a set of objects based on specific fields.
// primary is the primary index key.
// keys is the set of fields to be able to query.
const _primaryKey = Symbol('_primaryKey')
const _index = Symbol('_index')
const defaultKeys = ['name', 'license', 'funding', 'realpath', 'packageName']
const { hasOwnProperty } = Object.prototype
const debug = require('./debug.js')

// handling for the outdated "licenses" array, just pick the first one
// also support the alternative spelling "licence"
const getLicense = pkg => {
  if (pkg) {
    const lic = pkg.license || pkg.licence
    if (lic) {
      return lic
    }
    const lics = pkg.licenses || pkg.licences
    if (Array.isArray(lics)) {
      return lics[0]
    }
  }
}

class Inventory extends Map {
  constructor (opt = {}) {
    const { primary, keys } = opt
    super()
    this[_primaryKey] = primary || 'location'
    this[_index] = (keys || defaultKeys).reduce((index, i) => {
      index.set(i, new Map())
      return index
    }, new Map())
  }

  get primaryKey () {
    return this[_primaryKey]
  }

  get indexes () {
    return [...this[_index].keys()]
  }

  * filter (fn) {
    for (const node of this.values()) {
      if (fn(node)) {
        yield node
      }
    }
  }

  add (node) {
    const root = super.get('')
    if (root && node.root !== root && node.root !== root.root) {
      debug(() => {
        throw Object.assign(new Error('adding external node to inventory'), {
          root: root.path,
          node: node.path,
          nodeRoot: node.root.path,
        })
      })
      return
    }

    const current = super.get(node[this.primaryKey])
    if (current) {
      if (current === node) {
        return
      }
      this.delete(current)
    }
    super.set(node[this.primaryKey], node)
    for (const [key, map] of this[_index].entries()) {
      // if the node has the value, but it's false, then use that
      const val_ = hasOwnProperty.call(node, key) ? node[key]
        : key === 'license' ? getLicense(node.package)
        : node[key] ? node[key]
        : node.package && node.package[key]
      const val = typeof val_ === 'string' ? val_
        : !val_ || typeof val_ !== 'object' ? val_
        : key === 'license' ? val_.type
        : key === 'funding' ? val_.url
        : /* istanbul ignore next - not used */ val_
      const set = map.get(val) || new Set()
      set.add(node)
      map.set(val, set)
    }
  }

  delete (node) {
    if (!this.has(node)) {
      return
    }

    super.delete(node[this.primaryKey])
    for (const [key, map] of this[_index].entries()) {
      const val = node[key] !== undefined ? node[key]
        : (node[key] || (node.package && node.package[key]))
      const set = map.get(val)
      if (set) {
        set.delete(node)
        if (set.size === 0) {
          map.delete(node[key])
        }
      }
    }
  }

  query (key, val) {
    const map = this[_index].get(key)
    return map && (arguments.length === 2 ? map.get(val) : map.keys()) ||
      new Set()
  }

  has (node) {
    return super.get(node[this.primaryKey]) === node
  }

  set (k, v) {
    throw new Error('direct set() not supported, use inventory.add(node)')
  }
}

module.exports = Inventory

}, function(modId) { var map = {"./debug.js":1653046641891}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641903, function(require, module, exports) {
const npa = require('npm-package-arg')
const semver = require('semver')

class OverrideSet {
  constructor ({ overrides, key, parent }) {
    this.parent = parent
    this.children = new Map()

    if (typeof overrides === 'string') {
      overrides = { '.': overrides }
    }

    // change a literal empty string to * so we can use truthiness checks on
    // the value property later
    if (overrides['.'] === '') {
      overrides['.'] = '*'
    }

    if (parent) {
      const spec = npa(key)
      if (!spec.name) {
        throw new Error(`Override without name: ${key}`)
      }

      this.name = spec.name
      spec.name = ''
      this.key = key
      this.keySpec = spec.rawSpec === '' ? '' : spec.toString()
      this.value = overrides['.'] || this.keySpec
    }

    for (const [key, childOverrides] of Object.entries(overrides)) {
      if (key === '.') {
        continue
      }

      const child = new OverrideSet({
        parent: this,
        key,
        overrides: childOverrides,
      })

      this.children.set(child.key, child)
    }
  }

  getEdgeRule (edge) {
    for (const rule of this.ruleset.values()) {
      if (rule.name !== edge.name) {
        continue
      }

      if (rule.keySpec === '' ||
        semver.intersects(edge.spec, rule.keySpec)) {
        return rule
      }
    }

    return this
  }

  getNodeRule (node) {
    for (const rule of this.ruleset.values()) {
      if (rule.name !== node.name) {
        continue
      }

      if (rule.keySpec === '' ||
        semver.satisfies(node.version, rule.keySpec) ||
        semver.satisfies(node.version, rule.value)) {
        return rule
      }
    }

    return this
  }

  getMatchingRule (node) {
    for (const rule of this.ruleset.values()) {
      if (rule.name !== node.name) {
        continue
      }

      if (rule.keySpec === '' ||
        semver.satisfies(node.version, rule.keySpec) ||
        semver.satisfies(node.version, rule.value)) {
        return rule
      }
    }

    return null
  }

  * ancestry () {
    for (let ancestor = this; ancestor; ancestor = ancestor.parent) {
      yield ancestor
    }
  }

  get isRoot () {
    return !this.parent
  }

  get ruleset () {
    const ruleset = new Map()

    for (const override of this.ancestry()) {
      for (const kid of override.children.values()) {
        if (!ruleset.has(kid.key)) {
          ruleset.set(kid.key, kid)
        }
      }

      if (!override.isRoot && !ruleset.has(override.key)) {
        ruleset.set(override.key, override)
      }
    }

    return ruleset
  }
}

module.exports = OverrideSet

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641904, function(require, module, exports) {
// Given a set of nodes in a tree, and a filter function to test
// incoming edges to the dep set that should be ignored otherwise.
//
// find the set of deps that are only depended upon by nodes in the set, or
// their dependencies, or edges that are ignored.
//
// Used when figuring out what to prune when replacing a node with a newer
// version, or when an optional dep fails to install.

const gatherDepSet = (set, edgeFilter) => {
  const deps = new Set(set)

  // add the full set of dependencies.  note that this loop will continue
  // as the deps set increases in size.
  for (const node of deps) {
    for (const edge of node.edgesOut.values()) {
      if (edge.to && edgeFilter(edge)) {
        deps.add(edge.to)
      }
    }
  }

  // now remove all nodes in the set that have a dependant outside the set
  // if any change is made, then re-check
  // continue until no changes made, or deps set evaporates fully.
  let changed = true
  while (changed === true && deps.size > 0) {
    changed = false
    for (const dep of deps) {
      for (const edge of dep.edgesIn) {
        if (!deps.has(edge.from) && edgeFilter(edge)) {
          changed = true
          deps.delete(dep)
          break
        }
      }
    }
  }

  return deps
}

module.exports = gatherDepSet

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641905, function(require, module, exports) {
// take a path and a resolved value, and turn it into a resolution from
// the given new path.  This is used with converting a package.json's
// relative file: path into one suitable for a lockfile, or between
// lockfiles, and for converting hosted git repos to a consistent url type.
const npa = require('npm-package-arg')
const relpath = require('./relpath.js')
const consistentResolve = (resolved, fromPath, toPath, relPaths = false) => {
  if (!resolved) {
    return null
  }

  try {
    const hostedOpt = { noCommittish: false }
    const {
      fetchSpec,
      saveSpec,
      type,
      hosted,
      rawSpec,
      raw,
    } = npa(resolved, fromPath)
    const isPath = type === 'file' || type === 'directory'
    return isPath && !relPaths ? `file:${fetchSpec}`
      : isPath ? 'file:' + (toPath ? relpath(toPath, fetchSpec) : fetchSpec)
      : hosted ? `git+${
        hosted.auth ? hosted.https(hostedOpt) : hosted.sshurl(hostedOpt)
      }`
      : type === 'git' ? saveSpec
      // always return something.  'foo' is interpreted as 'foo@' otherwise.
      : rawSpec === '' && raw.slice(-1) !== '@' ? raw
      // just strip off the name, but otherwise return as-is
      : rawSpec
  } catch (_) {
    // whatever we passed in was not acceptable to npa.
    // leave it 100% untouched.
    return resolved
  }
}
module.exports = consistentResolve

}, function(modId) { var map = {"./relpath.js":1653046641897}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641906, function(require, module, exports) {
// helper function to output a clearer visualization
// of the current node and its descendents
const localeCompare = require('@isaacs/string-locale-compare')('en')
const util = require('util')
const relpath = require('./relpath.js')

class ArboristNode {
  constructor (tree, path) {
    this.name = tree.name
    if (tree.packageName && tree.packageName !== this.name) {
      this.packageName = tree.packageName
    }
    if (tree.version) {
      this.version = tree.version
    }
    this.location = tree.location
    this.path = tree.path
    if (tree.realpath !== this.path) {
      this.realpath = tree.realpath
    }
    if (tree.resolved !== null) {
      this.resolved = tree.resolved
    }
    if (tree.extraneous) {
      this.extraneous = true
    }
    if (tree.dev) {
      this.dev = true
    }
    if (tree.optional) {
      this.optional = true
    }
    if (tree.devOptional && !tree.dev && !tree.optional) {
      this.devOptional = true
    }
    if (tree.peer) {
      this.peer = true
    }
    if (tree.inBundle) {
      this.bundled = true
    }
    if (tree.inDepBundle) {
      this.bundler = tree.getBundler().location
    }
    if (tree.isProjectRoot) {
      this.isProjectRoot = true
    }
    if (tree.isWorkspace) {
      this.isWorkspace = true
    }
    const bd = tree.package && tree.package.bundleDependencies
    if (bd && bd.length) {
      this.bundleDependencies = bd
    }
    if (tree.inShrinkwrap) {
      this.inShrinkwrap = true
    } else if (tree.hasShrinkwrap) {
      this.hasShrinkwrap = true
    }
    if (tree.error) {
      this.error = treeError(tree.error)
    }
    if (tree.errors && tree.errors.length) {
      this.errors = tree.errors.map(treeError)
    }

    if (tree.overrides) {
      this.overrides = new Map([...tree.overrides.ruleset.values()]
        .map((override) => [override.key, override.value]))
    }

    // edgesOut sorted by name
    if (tree.edgesOut.size) {
      this.edgesOut = new Map([...tree.edgesOut.entries()]
        .sort(([a], [b]) => localeCompare(a, b))
        .map(([name, edge]) => [name, new EdgeOut(edge)]))
    }

    // edgesIn sorted by location
    if (tree.edgesIn.size) {
      this.edgesIn = new Set([...tree.edgesIn]
        .sort((a, b) => localeCompare(a.from.location, b.from.location))
        .map(edge => new EdgeIn(edge)))
    }

    if (tree.workspaces && tree.workspaces.size) {
      this.workspaces = new Map([...tree.workspaces.entries()]
        .map(([name, path]) => [name, relpath(tree.root.realpath, path)]))
    }

    // fsChildren sorted by path
    if (tree.fsChildren.size) {
      this.fsChildren = new Set([...tree.fsChildren]
        .sort(({ path: a }, { path: b }) => localeCompare(a, b))
        .map(tree => printableTree(tree, path)))
    }

    // children sorted by name
    if (tree.children.size) {
      this.children = new Map([...tree.children.entries()]
        .sort(([a], [b]) => localeCompare(a, b))
        .map(([name, tree]) => [name, printableTree(tree, path)]))
    }
  }
}

class ArboristVirtualNode extends ArboristNode {
  constructor (tree, path) {
    super(tree, path)
    this.sourceReference = printableTree(tree.sourceReference, path)
  }
}

class ArboristLink extends ArboristNode {
  constructor (tree, path) {
    super(tree, path)
    this.target = printableTree(tree.target, path)
  }
}

const treeError = ({ code, path }) => ({
  code,
  ...(path ? { path } : {}),
})

// print out edges without dumping the full node all over again
// this base class will toJSON as a plain old object, but the
// util.inspect() output will be a bit cleaner
class Edge {
  constructor (edge) {
    this.type = edge.type
    this.name = edge.name
    this.spec = edge.rawSpec || '*'
    if (edge.rawSpec !== edge.spec) {
      this.override = edge.spec
    }
    if (edge.error) {
      this.error = edge.error
    }
    if (edge.peerConflicted) {
      this.peerConflicted = edge.peerConflicted
    }
  }
}

// don't care about 'from' for edges out
class EdgeOut extends Edge {
  constructor (edge) {
    super(edge)
    this.to = edge.to && edge.to.location
  }

  [util.inspect.custom] () {
    return `{ ${this.type} ${this.name}@${this.spec}${
      this.override ? ` overridden:${this.override}` : ''
    }${
      this.to ? ' -> ' + this.to : ''
    }${
      this.error ? ' ' + this.error : ''
    }${
      this.peerConflicted ? ' peerConflicted' : ''
    } }`
  }
}

// don't care about 'to' for edges in
class EdgeIn extends Edge {
  constructor (edge) {
    super(edge)
    this.from = edge.from && edge.from.location
  }

  [util.inspect.custom] () {
    return `{ ${this.from || '""'} ${this.type} ${this.name}@${this.spec}${
      this.error ? ' ' + this.error : ''
    }${
      this.peerConflicted ? ' peerConflicted' : ''
    } }`
  }
}

const printableTree = (tree, path = []) => {
  if (!tree) {
    return tree
  }

  const Cls = tree.isLink ? ArboristLink
    : tree.sourceReference ? ArboristVirtualNode
    : ArboristNode
  if (path.includes(tree)) {
    const obj = Object.create(Cls.prototype)
    return Object.assign(obj, { location: tree.location })
  }
  path.push(tree)
  return new Cls(tree, path)
}

module.exports = printableTree

}, function(modId) { var map = {"./relpath.js":1653046641897}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641907, function(require, module, exports) {
// package children are represented with a Map object, but many file systems
// are case-insensitive and unicode-normalizing, so we need to treat
// node.children.get('FOO') and node.children.get('foo') as the same thing.

const _keys = Symbol('keys')
const _normKey = Symbol('normKey')
const normalize = s => s.normalize('NFKD').toLowerCase()
const OGMap = Map
module.exports = class Map extends OGMap {
  constructor (items = []) {
    super()
    this[_keys] = new OGMap()
    for (const [key, val] of items) {
      this.set(key, val)
    }
  }

  [_normKey] (key) {
    return typeof key === 'string' ? normalize(key) : key
  }

  get (key) {
    const normKey = this[_normKey](key)
    return this[_keys].has(normKey) ? super.get(this[_keys].get(normKey))
      : undefined
  }

  set (key, val) {
    const normKey = this[_normKey](key)
    if (this[_keys].has(normKey)) {
      super.delete(this[_keys].get(normKey))
    }
    this[_keys].set(normKey, key)
    return super.set(key, val)
  }

  delete (key) {
    const normKey = this[_normKey](key)
    if (this[_keys].has(normKey)) {
      const prevKey = this[_keys].get(normKey)
      this[_keys].delete(normKey)
      return super.delete(prevKey)
    }
  }

  has (key) {
    const normKey = this[_normKey](key)
    return this[_keys].has(normKey) && super.has(this[_keys].get(normKey))
  }
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641908, function(require, module, exports) {
const { depth } = require('treeverse')

const calcDepFlags = (tree, resetRoot = true) => {
  if (resetRoot) {
    tree.dev = false
    tree.optional = false
    tree.devOptional = false
    tree.peer = false
  }
  const ret = depth({
    tree,
    visit: node => calcDepFlagsStep(node),
    filter: node => node,
    getChildren: (node, tree) =>
      [...tree.edgesOut.values()].map(edge => edge.to),
  })
  return ret
}

const calcDepFlagsStep = (node) => {
  // This rewalk is necessary to handle cases where devDep and optional
  // or normal dependency graphs overlap deep in the dep graph.
  // Since we're only walking through deps that are not already flagged
  // as non-dev/non-optional, it's typically a very shallow traversal
  node.extraneous = false
  resetParents(node, 'extraneous')
  resetParents(node, 'dev')
  resetParents(node, 'peer')
  resetParents(node, 'devOptional')
  resetParents(node, 'optional')

  // for links, map their hierarchy appropriately
  if (node.isLink) {
    node.target.dev = node.dev
    node.target.optional = node.optional
    node.target.devOptional = node.devOptional
    node.target.peer = node.peer
    return calcDepFlagsStep(node.target)
  }

  node.edgesOut.forEach(({ peer, optional, dev, to }) => {
    // if the dep is missing, then its flags are already maximally unset
    if (!to) {
      return
    }

    // everything with any kind of edge into it is not extraneous
    to.extraneous = false

    // devOptional is the *overlap* of the dev and optional tree.
    // however, for convenience and to save an extra rewalk, we leave
    // it set when we are in *either* tree, and then omit it from the
    // package-lock if either dev or optional are set.
    const unsetDevOpt = !node.devOptional && !node.dev && !node.optional &&
      !dev && !optional

    // if we are not in the devOpt tree, then we're also not in
    // either the dev or opt trees
    const unsetDev = unsetDevOpt || !node.dev && !dev
    const unsetOpt = unsetDevOpt ||
      !node.optional && !optional
    const unsetPeer = !node.peer && !peer

    if (unsetPeer) {
      unsetFlag(to, 'peer')
    }

    if (unsetDevOpt) {
      unsetFlag(to, 'devOptional')
    }

    if (unsetDev) {
      unsetFlag(to, 'dev')
    }

    if (unsetOpt) {
      unsetFlag(to, 'optional')
    }
  })

  return node
}

const resetParents = (node, flag) => {
  if (node[flag]) {
    return
  }

  for (let p = node; p && (p === node || p[flag]); p = p.resolveParent) {
    p[flag] = false
  }
}

// typically a short walk, since it only traverses deps that
// have the flag set.
const unsetFlag = (node, flag) => {
  if (node[flag]) {
    node[flag] = false
    depth({
      tree: node,
      visit: node => {
        node.extraneous = node[flag] = false
        if (node.isLink) {
          node.target.extraneous = node.target[flag] = false
        }
      },
      getChildren: node => [...node.target.edgesOut.values()]
        .filter(edge => edge.to && edge.to[flag] &&
          (flag !== 'peer' && edge.type === 'peer' || edge.type === 'prod'))
        .map(edge => edge.to),
    })
  }
}

module.exports = calcDepFlags

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641909, function(require, module, exports) {
// a module that manages a shrinkwrap file (npm-shrinkwrap.json or
// package-lock.json).

// Increment whenever the lockfile version updates
// v1 - npm <=6
// v2 - arborist v1, npm v7, backwards compatible with v1, add 'packages'
// v3 will drop the 'dependencies' field, backwards comp with v2, not v1
//
// We cannot bump to v3 until npm v6 is out of common usage, and
// definitely not before npm v8.

const localeCompare = require('@isaacs/string-locale-compare')('en')
const defaultLockfileVersion = 2

// for comparing nodes to yarn.lock entries
const mismatch = (a, b) => a && b && a !== b

// this.tree => the root node for the tree (ie, same path as this)
// - Set the first time we do `this.add(node)` for a path matching this.path
//
// this.add(node) =>
// - decorate the node with the metadata we have, if we have it, and it matches
// - add to the map of nodes needing to be committed, so that subsequent
// changes are captured when we commit that location's metadata.
//
// this.commit() =>
// - commit all nodes awaiting update to their metadata entries
// - re-generate this.data and this.yarnLock based on this.tree
//
// Note that between this.add() and this.commit(), `this.data` will be out of
// date!  Always call `commit()` before relying on it.
//
// After calling this.commit(), any nodes not present in the tree will have
// been removed from the shrinkwrap data as well.

const log = require('proc-log')
const YarnLock = require('./yarn-lock.js')
const { promisify } = require('util')
const rimraf = promisify(require('rimraf'))
const fs = require('fs')
const readFile = promisify(fs.readFile)
const writeFile = promisify(fs.writeFile)
const stat = promisify(fs.stat)
const readdir_ = promisify(fs.readdir)
const readlink = promisify(fs.readlink)

// XXX remove when drop support for node v10
const lstat = promisify(fs.lstat)
/* istanbul ignore next - version specific polyfill */
const readdir = async (path, opt) => {
  if (!opt || !opt.withFileTypes) {
    return readdir_(path, opt)
  }
  const ents = await readdir_(path, opt)
  if (typeof ents[0] === 'string') {
    return Promise.all(ents.map(async ent => {
      return Object.assign(await lstat(path + '/' + ent), { name: ent })
    }))
  }
  return ents
}

const { resolve, basename } = require('path')
const specFromLock = require('./spec-from-lock.js')
const versionFromTgz = require('./version-from-tgz.js')
const npa = require('npm-package-arg')
const rpj = require('read-package-json-fast')
const parseJSON = require('parse-conflict-json')

const stringify = require('json-stringify-nice')
const swKeyOrder = [
  'name',
  'version',
  'lockfileVersion',
  'resolved',
  'integrity',
  'requires',
  'packages',
  'dependencies',
]

// used to rewrite from yarn registry to npm registry
const yarnRegRe = /^https?:\/\/registry\.yarnpkg\.com\//
const npmRegRe = /^https?:\/\/registry\.npmjs\.org\//

// sometimes resolved: is weird or broken, or something npa can't handle
const specFromResolved = resolved => {
  try {
    return npa(resolved)
  } catch (er) {
    return {}
  }
}

const relpath = require('./relpath.js')

const consistentResolve = require('./consistent-resolve.js')

const maybeReadFile = file => {
  return readFile(file, 'utf8').then(d => d, er => {
    /* istanbul ignore else - can't test without breaking module itself */
    if (er.code === 'ENOENT') {
      return ''
    } else {
      throw er
    }
  })
}

const maybeStatFile = file => {
  return stat(file).then(st => st.isFile(), er => {
    /* istanbul ignore else - can't test without breaking module itself */
    if (er.code === 'ENOENT') {
      return null
    } else {
      throw er
    }
  })
}

const pkgMetaKeys = [
  // note: name is included if necessary, for alias packages
  'version',
  'dependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'optionalDependencies',
  'bundleDependencies',
  'acceptDependencies',
  'funding',
  'engines',
  'os',
  'cpu',
  '_integrity',
  'license',
  '_hasShrinkwrap',
  'hasInstallScript',
  'bin',
  'deprecated',
  'workspaces',
]

const nodeMetaKeys = [
  'integrity',
  'inBundle',
  'hasShrinkwrap',
  'hasInstallScript',
]

const metaFieldFromPkg = (pkg, key) => {
  const val = pkg[key]
  // get the license type, not an object
  return (key === 'license' && val && typeof val === 'object' && val.type)
    ? val.type
    // skip empty objects and falsey values
    : (val && !(typeof val === 'object' && !Object.keys(val).length)) ? val
    : null
}

// check to make sure that there are no packages newer than the hidden lockfile
const assertNoNewer = async (path, data, lockTime, dir = path, seen = null) => {
  const base = basename(dir)
  const isNM = dir !== path && base === 'node_modules'
  const isScope = dir !== path && !isNM && base.charAt(0) === '@'
  const isParent = dir === path || isNM || isScope

  const rel = relpath(path, dir)
  if (dir !== path) {
    const dirTime = (await stat(dir)).mtime
    if (dirTime > lockTime) {
      throw 'out of date, updated: ' + rel
    }
    if (!isScope && !isNM && !data.packages[rel]) {
      throw 'missing from lockfile: ' + rel
    }
    seen.add(rel)
  } else {
    seen = new Set([rel])
  }

  const parent = isParent ? dir : resolve(dir, 'node_modules')
  const children = dir === path
    ? Promise.resolve([{ name: 'node_modules', isDirectory: () => true }])
    : readdir(parent, { withFileTypes: true })

  return children.catch(() => [])
    .then(ents => Promise.all(ents.map(async ent => {
      const child = resolve(parent, ent.name)
      if (ent.isDirectory() && !/^\./.test(ent.name)) {
        await assertNoNewer(path, data, lockTime, child, seen)
      } else if (ent.isSymbolicLink()) {
        const target = resolve(parent, await readlink(child))
        const tstat = await stat(target).catch(
          /* istanbul ignore next - windows */ () => null)
        seen.add(relpath(path, child))
        /* istanbul ignore next - windows cannot do this */
        if (tstat && tstat.isDirectory() && !seen.has(relpath(path, target))) {
          await assertNoNewer(path, data, lockTime, target, seen)
        }
      }
    })))
    .then(() => {
      if (dir !== path) {
        return
      }

      // assert that all the entries in the lockfile were seen
      for (const loc of new Set(Object.keys(data.packages))) {
        if (!seen.has(loc)) {
          throw 'missing from node_modules: ' + loc
        }
      }
    })
}

const _awaitingUpdate = Symbol('_awaitingUpdate')
const _updateWaitingNode = Symbol('_updateWaitingNode')
const _lockFromLoc = Symbol('_lockFromLoc')
const _pathToLoc = Symbol('_pathToLoc')
const _loadAll = Symbol('_loadAll')
const _metaFromLock = Symbol('_metaFromLock')
const _resolveMetaNode = Symbol('_resolveMetaNode')
const _fixDependencies = Symbol('_fixDependencies')
const _buildLegacyLockfile = Symbol('_buildLegacyLockfile')
const _filenameSet = Symbol('_filenameSet')
const _maybeRead = Symbol('_maybeRead')
const _maybeStat = Symbol('_maybeStat')
class Shrinkwrap {
  static get defaultLockfileVersion () {
    return defaultLockfileVersion
  }

  static load (options) {
    return new Shrinkwrap(options).load()
  }

  static get keyOrder () {
    return swKeyOrder
  }

  static async reset (options) {
    // still need to know if it was loaded from the disk, but don't
    // bother reading it if we're gonna just throw it away.
    const s = new Shrinkwrap(options)
    s.reset()

    const [sw, lock] = await s[_maybeStat]()

    s.filename = resolve(s.path,
      (s.hiddenLockfile ? 'node_modules/.package-lock'
      : s.shrinkwrapOnly || sw ? 'npm-shrinkwrap'
      : 'package-lock') + '.json')
    s.loadedFromDisk = !!(sw || lock)
    s.type = basename(s.filename)

    try {
      if (s.loadedFromDisk && !s.lockfileVersion) {
        const json = parseJSON(await maybeReadFile(s.filename))
        if (json.lockfileVersion > defaultLockfileVersion) {
          s.lockfileVersion = json.lockfileVersion
        }
      }
    } catch (e) {}

    return s
  }

  static metaFromNode (node, path) {
    if (node.isLink) {
      return {
        resolved: relpath(path, node.realpath),
        link: true,
      }
    }

    const meta = {}
    pkgMetaKeys.forEach(key => {
      const val = metaFieldFromPkg(node.package, key)
      if (val) {
        meta[key.replace(/^_/, '')] = val
      }
    })
    // we only include name if different from the node path name, and for the
    // root to help prevent churn based on the name of the directory the
    // project is in
    const pname = node.packageName
    if (pname && (node === node.root || pname !== node.name)) {
      meta.name = pname
    }

    if (node.isTop && node.package.devDependencies) {
      meta.devDependencies = node.package.devDependencies
    }

    nodeMetaKeys.forEach(key => {
      if (node[key]) {
        meta[key] = node[key]
      }
    })

    const resolved = consistentResolve(node.resolved, node.path, path, true)
    if (resolved) {
      meta.resolved = resolved
    }

    if (node.extraneous) {
      meta.extraneous = true
    } else {
      if (node.peer) {
        meta.peer = true
      }
      if (node.dev) {
        meta.dev = true
      }
      if (node.optional) {
        meta.optional = true
      }
      if (node.devOptional && !node.dev && !node.optional) {
        meta.devOptional = true
      }
    }
    return meta
  }

  constructor (options = {}) {
    const {
      path,
      indent = 2,
      newline = '\n',
      shrinkwrapOnly = false,
      hiddenLockfile = false,
      lockfileVersion,
    } = options

    this.lockfileVersion = hiddenLockfile ? 3
      : lockfileVersion ? parseInt(lockfileVersion, 10)
      : null
    this[_awaitingUpdate] = new Map()
    this.tree = null
    this.path = resolve(path || '.')
    this.filename = null
    this.data = null
    this.indent = indent
    this.newline = newline
    this.loadedFromDisk = false
    this.type = null
    this.yarnLock = null
    this.hiddenLockfile = hiddenLockfile
    this.loadingError = null
    // only load npm-shrinkwrap.json in dep trees, not package-lock
    this.shrinkwrapOnly = shrinkwrapOnly
  }

  // check to see if a spec is present in the yarn.lock file, and if so,
  // if we should use it, and what it should resolve to.  This is only
  // done when we did not load a shrinkwrap from disk.  Also, decorate
  // the options object if provided with the resolved and integrity that
  // we expect.
  checkYarnLock (spec, options = {}) {
    spec = npa(spec)
    const { yarnLock, loadedFromDisk } = this
    const useYarnLock = yarnLock && !loadedFromDisk
    const fromYarn = useYarnLock && yarnLock.entries.get(spec.raw)
    if (fromYarn && fromYarn.version) {
      // if it's the yarn or npm default registry, use the version as
      // our effective spec.  if it's any other kind of thing, use that.
      const { resolved, version, integrity } = fromYarn
      const isYarnReg = spec.registry && yarnRegRe.test(resolved)
      const isnpmReg = spec.registry && !isYarnReg && npmRegRe.test(resolved)
      const isReg = isnpmReg || isYarnReg
      // don't use the simple version if the "registry" url is
      // something else entirely!
      const tgz = isReg && versionFromTgz(spec.name, resolved) || {}
      const yspec = tgz.name === spec.name && tgz.version === version ? version
        : isReg && tgz.name && tgz.version ? `npm:${tgz.name}@${tgz.version}`
        : resolved
      if (yspec) {
        options.resolved = resolved.replace(yarnRegRe, 'https://registry.npmjs.org/')
        options.integrity = integrity
        return npa(`${spec.name}@${yspec}`)
      }
    }
    return spec
  }

  // throw away the shrinkwrap data so we can start fresh
  // still worth doing a load() first so we know which files to write.
  reset () {
    this.tree = null
    this[_awaitingUpdate] = new Map()
    const lockfileVersion = this.lockfileVersion || defaultLockfileVersion
    this.originalLockfileVersion = lockfileVersion
    this.data = {
      lockfileVersion,
      requires: true,
      packages: {},
      dependencies: {},
    }
  }

  [_filenameSet] () {
    return this.shrinkwrapOnly ? [
      this.path + '/npm-shrinkwrap.json',
    ] : this.hiddenLockfile ? [
      null,
      this.path + '/node_modules/.package-lock.json',
    ] : [
      this.path + '/npm-shrinkwrap.json',
      this.path + '/package-lock.json',
      this.path + '/yarn.lock',
    ]
  }

  [_maybeRead] () {
    return Promise.all(this[_filenameSet]().map(fn => fn && maybeReadFile(fn)))
  }

  [_maybeStat] () {
    // throw away yarn, we only care about lock or shrinkwrap when checking
    // this way, since we're not actually loading the full lock metadata
    return Promise.all(this[_filenameSet]().slice(0, 2)
      .map(fn => fn && maybeStatFile(fn)))
  }

  inferFormattingOptions (packageJSONData) {
    // don't use detect-indent, just pick the first line.
    // if the file starts with {" then we have an indent of '', ie, none
    // which will default to 2 at save time.
    const {
      [Symbol.for('indent')]: indent,
      [Symbol.for('newline')]: newline,
    } = packageJSONData
    this.indent = indent !== undefined ? indent : this.indent
    this.newline = newline !== undefined ? newline : this.newline
  }

  load () {
    // we don't need to load package-lock.json except for top of tree nodes,
    // only npm-shrinkwrap.json.
    return this[_maybeRead]().then(([sw, lock, yarn]) => {
      const data = sw || lock || ''

      // use shrinkwrap only for deps, otherwise prefer package-lock
      // and ignore npm-shrinkwrap if both are present.
      // TODO: emit a warning here or something if both are present.
      this.filename = resolve(this.path,
        (this.hiddenLockfile ? 'node_modules/.package-lock'
        : this.shrinkwrapOnly || sw ? 'npm-shrinkwrap'
        : 'package-lock') + '.json')

      this.type = basename(this.filename)
      this.loadedFromDisk = !!data

      if (yarn) {
        this.yarnLock = new YarnLock()
        // ignore invalid yarn data.  we'll likely clobber it later anyway.
        try {
          this.yarnLock.parse(yarn)
        } catch (_) {}
      }

      return data ? parseJSON(data) : {}
    }).then(async data => {
      this.inferFormattingOptions(data)

      if (!this.hiddenLockfile || !data.packages) {
        return data
      }

      // add a few ms just to account for jitter
      const lockTime = +(await stat(this.filename)).mtime + 10
      await assertNoNewer(this.path, data, lockTime)

      // all good!  hidden lockfile is the newest thing in here.
      return data
    }).catch(er => {
      /* istanbul ignore else */
      if (typeof this.filename === 'string') {
        const rel = relpath(this.path, this.filename)
        log.verbose('shrinkwrap', `failed to load ${rel}`, er)
      } else {
        log.verbose('shrinkwrap', `failed to load ${this.path}`, er)
      }
      this.loadingError = er
      this.loadedFromDisk = false
      this.ancientLockfile = false
      return {}
    }).then(lock => {
      const lockfileVersion = this.lockfileVersion ? this.lockfileVersion
        : Math.max(lock.lockfileVersion || 0, defaultLockfileVersion)
      this.data = {
        ...lock,
        lockfileVersion: lockfileVersion,
        requires: true,
        packages: lock.packages || {},
        dependencies: lock.dependencies || {},
      }

      this.originalLockfileVersion = lock.lockfileVersion
      // use default if it wasn't explicitly set, and the current file is
      // less than our default.  otherwise, keep whatever is in the file,
      // unless we had an explicit setting already.
      if (!this.lockfileVersion) {
        this.lockfileVersion = this.data.lockfileVersion = lockfileVersion
      }
      this.ancientLockfile = this.loadedFromDisk &&
        !(lock.lockfileVersion >= 2) && !lock.requires

      // load old lockfile deps into the packages listing
      if (lock.dependencies && !lock.packages) {
        return rpj(this.path + '/package.json').then(pkg => pkg, er => ({}))
          .then(pkg => {
            this[_loadAll]('', null, this.data)
            this[_fixDependencies](pkg)
          })
      }
    })
      .then(() => this)
  }

  [_loadAll] (location, name, lock) {
    // migrate a v1 package lock to the new format.
    const meta = this[_metaFromLock](location, name, lock)
    // dependencies nested under a link are actually under the link target
    if (meta.link) {
      location = meta.resolved
    }
    if (lock.dependencies) {
      for (const [name, dep] of Object.entries(lock.dependencies)) {
        const loc = location + (location ? '/' : '') + 'node_modules/' + name
        this[_loadAll](loc, name, dep)
      }
    }
  }

  // v1 lockfiles track the optional/dev flags, but they don't tell us
  // which thing had what kind of dep on what other thing, so we need
  // to correct that now, or every link will be considered prod
  [_fixDependencies] (pkg) {
    // we need the root package.json because legacy shrinkwraps just
    // have requires:true at the root level, which is even less useful
    // than merging all dep types into one object.
    const root = this.data.packages['']
    pkgMetaKeys.forEach(key => {
      const val = metaFieldFromPkg(pkg, key)
      const k = key.replace(/^_/, '')
      if (val) {
        root[k] = val
      }
    })

    for (const [loc, meta] of Object.entries(this.data.packages)) {
      if (!meta.requires || !loc) {
        continue
      }

      // resolve each require to a meta entry
      // if this node isn't optional, but the dep is, then it's an optionalDep
      // likewise for dev deps.
      // This isn't perfect, but it's a pretty good approximation, and at
      // least gets us out of having all 'prod' edges, which throws off the
      // buildIdealTree process
      for (const [name, spec] of Object.entries(meta.requires)) {
        const dep = this[_resolveMetaNode](loc, name)
        // this overwrites the false value set above
        const depType = dep && dep.optional && !meta.optional
          ? 'optionalDependencies'
          : /* istanbul ignore next - dev deps are only for the root level */
          dep && dep.dev && !meta.dev ? 'devDependencies'
          // also land here if the dep just isn't in the tree, which maybe
          // should be an error, since it means that the shrinkwrap is
          // invalid, but we can't do much better without any info.
          : 'dependencies'
        meta[depType] = meta[depType] || {}
        meta[depType][name] = spec
      }
      delete meta.requires
    }
  }

  [_resolveMetaNode] (loc, name) {
    for (let path = loc; true; path = path.replace(/(^|\/)[^/]*$/, '')) {
      const check = `${path}${path ? '/' : ''}node_modules/${name}`
      if (this.data.packages[check]) {
        return this.data.packages[check]
      }

      if (!path) {
        break
      }
    }
    return null
  }

  [_lockFromLoc] (lock, path, i = 0) {
    if (!lock) {
      return null
    }

    if (path[i] === '') {
      i++
    }

    if (i >= path.length) {
      return lock
    }

    if (!lock.dependencies) {
      return null
    }

    return this[_lockFromLoc](lock.dependencies[path[i]], path, i + 1)
  }

  // pass in a path relative to the root path, or an absolute path,
  // get back a /-normalized location based on root path.
  [_pathToLoc] (path) {
    return relpath(this.path, resolve(this.path, path))
  }

  delete (nodePath) {
    if (!this.data) {
      throw new Error('run load() before getting or setting data')
    }
    const location = this[_pathToLoc](nodePath)
    this[_awaitingUpdate].delete(location)

    delete this.data.packages[location]
    const path = location.split(/(?:^|\/)node_modules\//)
    const name = path.pop()
    const pLock = this[_lockFromLoc](this.data, path)
    if (pLock && pLock.dependencies) {
      delete pLock.dependencies[name]
    }
  }

  get (nodePath) {
    if (!this.data) {
      throw new Error('run load() before getting or setting data')
    }

    const location = this[_pathToLoc](nodePath)
    if (this[_awaitingUpdate].has(location)) {
      this[_updateWaitingNode](location)
    }

    // first try to get from the newer spot, which we know has
    // all the things we need.
    if (this.data.packages[location]) {
      return this.data.packages[location]
    }

    // otherwise, fall back to the legacy metadata, and hope for the best
    // get the node in the shrinkwrap corresponding to this spot
    const path = location.split(/(?:^|\/)node_modules\//)
    const name = path[path.length - 1]
    const lock = this[_lockFromLoc](this.data, path)

    return this[_metaFromLock](location, name, lock)
  }

  [_metaFromLock] (location, name, lock) {
    // This function tries as hard as it can to figure out the metadata
    // from a lockfile which may be outdated or incomplete.  Since v1
    // lockfiles used the "version" field to contain a variety of
    // different possible types of data, this gets a little complicated.
    if (!lock) {
      return {}
    }

    // try to figure out a npm-package-arg spec from the lockfile entry
    // This will return null if we could not get anything valid out of it.
    const spec = specFromLock(name, lock, this.path)

    if (spec.type === 'directory') {
      // the "version" was a file: url to a non-tarball path
      // this is a symlink dep.  We don't store much metadata
      // about symlinks, just the target.
      const target = relpath(this.path, spec.fetchSpec)
      this.data.packages[location] = {
        link: true,
        resolved: target,
      }
      // also save the link target, omitting version since we don't know
      // what it is, but we know it isn't a link to itself!
      if (!this.data.packages[target]) {
        this[_metaFromLock](target, name, { ...lock, version: null })
      }
      return this.data.packages[location]
    }

    const meta = {}
    // when calling loadAll we'll change these into proper dep objects
    if (lock.requires && typeof lock.requires === 'object') {
      meta.requires = lock.requires
    }

    if (lock.optional) {
      meta.optional = true
    }
    if (lock.dev) {
      meta.dev = true
    }

    // the root will typically have a name from the root project's
    // package.json file.
    if (location === '') {
      meta.name = lock.name
    }

    // if we have integrity, save it now.
    if (lock.integrity) {
      meta.integrity = lock.integrity
    }

    if (lock.version && !lock.integrity) {
      // this is usually going to be a git url or symlink, but it could
      // also be a registry dependency that did not have integrity at
      // the time it was saved.
      // Symlinks were already handled above, so that leaves git.
      //
      // For git, always save the full SSH url.  we'll actually fetch the
      // tgz most of the time, since it's faster, but it won't work for
      // private repos, and we can't get back to the ssh from the tgz,
      // so we store the ssh instead.
      // For unknown git hosts, just resolve to the raw spec in lock.version
      if (spec.type === 'git') {
        meta.resolved = consistentResolve(spec, this.path, this.path)

        // return early because there is nothing else we can do with this
        return this.data.packages[location] = meta
      } else if (spec.registry) {
        // registry dep that didn't save integrity.  grab the version, and
        // fall through to pick up the resolved and potentially name.
        meta.version = lock.version
      }
      // only other possible case is a tarball without integrity.
      // fall through to do what we can with the filename later.
    }

    // at this point, we know that the spec is either a registry dep
    // (ie, version, because locking, which means a resolved url),
    // or a remote dep, or file: url.  Remote deps and file urls
    // have a fetchSpec equal to the fully resolved thing.
    // Registry deps, we take what's in the lockfile.
    if (lock.resolved || (spec.type && !spec.registry)) {
      if (spec.registry) {
        meta.resolved = lock.resolved
      } else if (spec.type === 'file') {
        meta.resolved = consistentResolve(spec, this.path, this.path, true)
      } else if (spec.fetchSpec) {
        meta.resolved = spec.fetchSpec
      }
    }

    // at this point, if still we don't have a version, do our best to
    // infer it from the tarball url/file.  This works a surprising
    // amount of the time, even though it's not guaranteed.
    if (!meta.version) {
      if (spec.type === 'file' || spec.type === 'remote') {
        const fromTgz = versionFromTgz(spec.name, spec.fetchSpec) ||
          versionFromTgz(spec.name, meta.resolved)
        if (fromTgz) {
          meta.version = fromTgz.version
          if (fromTgz.name !== name) {
            meta.name = fromTgz.name
          }
        }
      } else if (spec.type === 'alias') {
        meta.name = spec.subSpec.name
        meta.version = spec.subSpec.fetchSpec
      } else if (spec.type === 'version') {
        meta.version = spec.fetchSpec
      }
      // ok, I did my best!  good luck!
    }

    if (lock.bundled) {
      meta.inBundle = true
    }

    // save it for next time
    return this.data.packages[location] = meta
  }

  add (node) {
    if (!this.data) {
      throw new Error('run load() before getting or setting data')
    }

    // will be actually updated on read
    const loc = relpath(this.path, node.path)
    if (node.path === this.path) {
      this.tree = node
    }

    // if we have metadata about this node, and it's a match, then
    // try to decorate it.
    if (node.resolved === null || node.integrity === null) {
      const {
        resolved,
        integrity,
        hasShrinkwrap,
        version,
      } = this.get(node.path)

      const pathFixed = !resolved ? null
        : !/^file:/.test(resolved) ? resolved
        // resolve onto the metadata path
        : `file:${resolve(this.path, resolved.substr(5))}`

      // if we have one, only set the other if it matches
      // otherwise it could be for a completely different thing.
      const resolvedOk = !resolved || !node.resolved ||
        node.resolved === pathFixed
      const integrityOk = !integrity || !node.integrity ||
        node.integrity === integrity
      const versionOk = !version || !node.version || version === node.version

      const allOk = (resolved || integrity || version) &&
        resolvedOk && integrityOk && versionOk

      if (allOk) {
        node.resolved = node.resolved || pathFixed || null
        node.integrity = node.integrity || integrity || null
        node.hasShrinkwrap = node.hasShrinkwrap || hasShrinkwrap || false
      } else {
        // try to read off the package or node itself
        const {
          resolved,
          integrity,
          hasShrinkwrap,
        } = Shrinkwrap.metaFromNode(node, this.path)
        node.resolved = node.resolved || resolved || null
        node.integrity = node.integrity || integrity || null
        node.hasShrinkwrap = node.hasShrinkwrap || hasShrinkwrap || false
      }
    }
    this[_awaitingUpdate].set(loc, node)
  }

  addEdge (edge) {
    if (!this.yarnLock || !edge.valid) {
      return
    }

    const { to: node } = edge

    // if it's already set up, nothing to do
    if (node.resolved !== null && node.integrity !== null) {
      return
    }

    // if the yarn lock is empty, nothing to do
    if (!this.yarnLock.entries || !this.yarnLock.entries.size) {
      return
    }

    // we relativize the path here because that's how it shows up in the lock
    // XXX how is this different from pathFixed above??
    const pathFixed = !node.resolved ? null
      : !/file:/.test(node.resolved) ? node.resolved
      : consistentResolve(node.resolved, node.path, this.path, true)

    const spec = npa(`${node.name}@${edge.spec}`)
    const entry = this.yarnLock.entries.get(`${node.name}@${edge.spec}`)

    if (!entry ||
        mismatch(node.version, entry.version) ||
        mismatch(node.integrity, entry.integrity) ||
        mismatch(pathFixed, entry.resolved)) {
      return
    }

    if (entry.resolved && yarnRegRe.test(entry.resolved) && spec.registry) {
      entry.resolved = entry.resolved.replace(yarnRegRe, 'https://registry.npmjs.org/')
    }

    node.integrity = node.integrity || entry.integrity || null
    node.resolved = node.resolved ||
      consistentResolve(entry.resolved, this.path, node.path) || null

    this[_awaitingUpdate].set(relpath(this.path, node.path), node)
  }

  [_updateWaitingNode] (loc) {
    const node = this[_awaitingUpdate].get(loc)
    this[_awaitingUpdate].delete(loc)
    this.data.packages[loc] = Shrinkwrap.metaFromNode(node, this.path)
  }

  commit () {
    if (this.tree) {
      if (this.yarnLock) {
        this.yarnLock.fromTree(this.tree)
      }
      const root = Shrinkwrap.metaFromNode(this.tree.target, this.path)
      this.data.packages = {}
      if (Object.keys(root).length) {
        this.data.packages[''] = root
      }
      for (const node of this.tree.root.inventory.values()) {
        // only way this.tree is not root is if the root is a link to it
        if (node === this.tree || node.isRoot || node.location === '') {
          continue
        }
        const loc = relpath(this.path, node.path)
        this.data.packages[loc] = Shrinkwrap.metaFromNode(node, this.path)
      }
    } else if (this[_awaitingUpdate].size > 0) {
      for (const loc of this[_awaitingUpdate].keys()) {
        this[_updateWaitingNode](loc)
      }
    }

    // if we haven't set it by now, use the default
    if (!this.lockfileVersion) {
      this.lockfileVersion = defaultLockfileVersion
    }
    this.data.lockfileVersion = this.lockfileVersion

    // hidden lockfiles don't include legacy metadata or a root entry
    if (this.hiddenLockfile) {
      delete this.data.packages['']
      delete this.data.dependencies
    } else if (this.tree && this.lockfileVersion <= 3) {
      this[_buildLegacyLockfile](this.tree, this.data)
    }

    // lf version 1 = dependencies only
    // lf version 2 = dependencies and packages
    // lf version 3 = packages only
    if (this.lockfileVersion >= 3) {
      const { dependencies, ...data } = this.data
      return data
    } else if (this.lockfileVersion < 2) {
      const { packages, ...data } = this.data
      return data
    } else {
      return { ...this.data }
    }
  }

  [_buildLegacyLockfile] (node, lock, path = []) {
    if (node === this.tree) {
      // the root node
      lock.name = node.packageName || node.name
      if (node.version) {
        lock.version = node.version
      }
    }

    // npm v6 and before tracked 'from', meaning "the request that led
    // to this package being installed".  However, that's inherently
    // racey and non-deterministic in a world where deps are deduped
    // ahead of fetch time.  In order to maintain backwards compatibility
    // with v6 in the lockfile, we do this trick where we pick a valid
    // dep link out of the edgesIn set.  Choose the edge with the fewest
    // number of `node_modules` sections in the requestor path, and then
    // lexically sort afterwards.
    const edge = [...node.edgesIn].filter(e => e.valid).sort((a, b) => {
      const aloc = a.from.location.split('node_modules')
      const bloc = b.from.location.split('node_modules')
      /* istanbul ignore next - sort calling order is indeterminate */
      return aloc.length > bloc.length ? 1
        : bloc.length > aloc.length ? -1
        : localeCompare(aloc[aloc.length - 1], bloc[bloc.length - 1])
    })[0]

    const res = consistentResolve(node.resolved, this.path, this.path, true)
    const rSpec = specFromResolved(res)

    // if we don't have anything (ie, it's extraneous) then use the resolved
    // value as if that was where we got it from, since at least it's true.
    // if we don't have either, just an empty object so nothing matches below.
    // This will effectively just save the version and resolved, as if it's
    // a standard version/range dep, which is a reasonable default.
    const spec = !edge ? rSpec
      : npa.resolve(node.name, edge.spec, edge.from.realpath)

    if (node.isLink) {
      lock.version = `file:${relpath(this.path, node.realpath)}`
    } else if (spec && (spec.type === 'file' || spec.type === 'remote')) {
      lock.version = spec.saveSpec
    } else if (spec && spec.type === 'git' || rSpec.type === 'git') {
      lock.version = node.resolved
      /* istanbul ignore else - don't think there are any cases where a git
       * spec (or indeed, ANY npa spec) doesn't have a .raw member */
      if (spec.raw) {
        lock.from = spec.raw
      }
    } else if (!node.isRoot &&
        node.package &&
        node.packageName &&
        node.packageName !== node.name) {
      lock.version = `npm:${node.packageName}@${node.version}`
    } else if (node.package && node.version) {
      lock.version = node.version
    }

    if (node.inDepBundle) {
      lock.bundled = true
    }

    // when we didn't resolve to git, file, or dir, and didn't request
    // git, file, dir, or remote, then the resolved value is necessary.
    if (node.resolved &&
        !node.isLink &&
        rSpec.type !== 'git' &&
        rSpec.type !== 'file' &&
        rSpec.type !== 'directory' &&
        spec.type !== 'directory' &&
        spec.type !== 'git' &&
        spec.type !== 'file' &&
        spec.type !== 'remote') {
      lock.resolved = node.resolved
    }

    if (node.integrity) {
      lock.integrity = node.integrity
    }

    if (node.extraneous) {
      lock.extraneous = true
    } else if (!node.isLink) {
      if (node.peer) {
        lock.peer = true
      }

      if (node.devOptional && !node.dev && !node.optional) {
        lock.devOptional = true
      }

      if (node.dev) {
        lock.dev = true
      }

      if (node.optional) {
        lock.optional = true
      }
    }

    const depender = node.target
    if (depender.edgesOut.size > 0) {
      if (node !== this.tree) {
        const entries = [...depender.edgesOut.entries()]
        lock.requires = entries.reduce((set, [k, v]) => {
          // omit peer deps from legacy lockfile requires field, because
          // npm v6 doesn't handle peer deps, and this triggers some bad
          // behavior if the dep can't be found in the dependencies list.
          const { spec, peer } = v
          if (peer) {
            return set
          }
          if (spec.startsWith('file:')) {
            // turn absolute file: paths into relative paths from the node
            // this especially shows up with workspace edges when the root
            // node is also a workspace in the set.
            const p = resolve(node.realpath, spec.substr('file:'.length))
            set[k] = `file:${relpath(node.realpath, p)}`
          } else {
            set[k] = spec
          }
          return set
        }, {})
      } else {
        lock.requires = true
      }
    }

    // now we walk the children, putting them in the 'dependencies' object
    const { children } = node.target
    if (!children.size) {
      delete lock.dependencies
    } else {
      const kidPath = [...path, node.realpath]
      const dependencies = {}
      // skip any that are already in the descent path, so cyclical link
      // dependencies don't blow up with ELOOP.
      let found = false
      for (const [name, kid] of children.entries()) {
        if (path.includes(kid.realpath)) {
          continue
        }
        dependencies[name] = this[_buildLegacyLockfile](kid, {}, kidPath)
        found = true
      }
      if (found) {
        lock.dependencies = dependencies
      }
    }
    return lock
  }

  toJSON () {
    if (!this.data) {
      throw new Error('run load() before getting or setting data')
    }

    return this.commit()
  }

  toString (options = {}) {
    const data = this.toJSON()
    const { format = true } = options
    const defaultIndent = this.indent || 2
    const indent = format === true ? defaultIndent
      : format || 0
    const eol = format ? this.newline || '\n' : ''
    return stringify(data, swKeyOrder, indent).replace(/\n/g, eol)
  }

  save (options = {}) {
    if (!this.data) {
      throw new Error('run load() before saving data')
    }
    const json = this.toString(options)
    return Promise.all([
      writeFile(this.filename, json).catch(er => {
        if (this.hiddenLockfile) {
          // well, we did our best.
          // if we reify, and there's nothing there, then it might be lacking
          // a node_modules folder, but then the lockfile is not important.
          // Remove the file, so that in case there WERE deps, but we just
          // failed to update the file for some reason, it's not out of sync.
          return rimraf(this.filename)
        }
        throw er
      }),
      this.yarnLock && this.yarnLock.entries.size &&
        writeFile(this.path + '/yarn.lock', this.yarnLock.toString()),
    ])
  }
}

module.exports = Shrinkwrap

}, function(modId) { var map = {"./yarn-lock.js":1653046641910,"./spec-from-lock.js":1653046641911,"./version-from-tgz.js":1653046641912,"./relpath.js":1653046641897,"./consistent-resolve.js":1653046641905}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641910, function(require, module, exports) {
// parse a yarn lock file
// basic format
//
// <request spec>[, <request spec> ...]:
//   <key> <value>
//   <subkey>:
//     <key> <value>
//
// Assume that any key or value might be quoted, though that's only done
// in practice if certain chars are in the string.  Quoting unnecessarily
// does not cause problems for yarn, so that's what we do when we write
// it back.
//
// The data format would support nested objects, but at this time, it
// appears that yarn does not use that for anything, so in the interest
// of a simpler parser algorithm, this implementation only supports a
// single layer of sub objects.
//
// This doesn't deterministically define the shape of the tree, and so
// cannot be used (on its own) for Arborist.loadVirtual.
// But it can give us resolved, integrity, and version, which is useful
// for Arborist.loadActual and for building the ideal tree.
//
// At the very least, when a yarn.lock file is present, we update it
// along the way, and save it back in Shrinkwrap.save()
//
// NIHing this rather than using @yarnpkg/lockfile because that module
// is an impenetrable 10kloc of webpack flow output, which is overkill
// for something relatively simple and tailored to Arborist's use case.

const localeCompare = require('@isaacs/string-locale-compare')('en')
const consistentResolve = require('./consistent-resolve.js')
const { dirname } = require('path')
const { breadth } = require('treeverse')

// sort a key/value object into a string of JSON stringified keys and vals
const sortKV = obj => Object.keys(obj)
  .sort(localeCompare)
  .map(k => `    ${JSON.stringify(k)} ${JSON.stringify(obj[k])}`)
  .join('\n')

// for checking against previous entries
const match = (p, n) =>
  p.integrity && n.integrity ? p.integrity === n.integrity
  : p.resolved && n.resolved ? p.resolved === n.resolved
  : p.version && n.version ? p.version === n.version
  : true

const prefix =
`# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
# yarn lockfile v1


`

const nullSymbol = Symbol('null')
class YarnLock {
  static parse (data) {
    return new YarnLock().parse(data)
  }

  static fromTree (tree) {
    return new YarnLock().fromTree(tree)
  }

  constructor () {
    this.entries = null
    this.endCurrent()
  }

  endCurrent () {
    this.current = null
    this.subkey = nullSymbol
  }

  parse (data) {
    const ENTRY_START = /^[^\s].*:$/
    const SUBKEY = /^ {2}[^\s]+:$/
    const SUBVAL = /^ {4}[^\s]+ .+$/
    const METADATA = /^ {2}[^\s]+ .+$/
    this.entries = new Map()
    this.current = null
    const linere = /([^\r\n]*)\r?\n/gm
    let match
    let lineNum = 0
    if (!/\n$/.test(data)) {
      data += '\n'
    }
    while (match = linere.exec(data)) {
      const line = match[1]
      lineNum++
      if (line.charAt(0) === '#') {
        continue
      }
      if (line === '') {
        this.endCurrent()
        continue
      }
      if (ENTRY_START.test(line)) {
        this.endCurrent()
        const specs = this.splitQuoted(line.slice(0, -1), /, */)
        this.current = new YarnLockEntry(specs)
        specs.forEach(spec => this.entries.set(spec, this.current))
        continue
      }
      if (SUBKEY.test(line)) {
        this.subkey = line.slice(2, -1)
        this.current[this.subkey] = {}
        continue
      }
      if (SUBVAL.test(line) && this.current && this.current[this.subkey]) {
        const subval = this.splitQuoted(line.trimLeft(), ' ')
        if (subval.length === 2) {
          this.current[this.subkey][subval[0]] = subval[1]
          continue
        }
      }
      // any other metadata
      if (METADATA.test(line) && this.current) {
        const metadata = this.splitQuoted(line.trimLeft(), ' ')
        if (metadata.length === 2) {
          // strip off the legacy shasum hashes
          if (metadata[0] === 'resolved') {
            metadata[1] = metadata[1].replace(/#.*/, '')
          }
          this.current[metadata[0]] = metadata[1]
          continue
        }
      }

      throw Object.assign(new Error('invalid or corrupted yarn.lock file'), {
        position: match.index,
        content: match[0],
        line: lineNum,
      })
    }
    this.endCurrent()
    return this
  }

  splitQuoted (str, delim) {
    // a,"b,c",d"e,f => ['a','"b','c"','d"e','f'] => ['a','b,c','d"e','f']
    const split = str.split(delim)
    const out = []
    let o = 0
    for (let i = 0; i < split.length; i++) {
      const chunk = split[i]
      if (/^".*"$/.test(chunk)) {
        out[o++] = chunk.trim().slice(1, -1)
      } else if (/^"/.test(chunk)) {
        let collect = chunk.trimLeft().slice(1)
        while (++i < split.length) {
          const n = split[i]
          // something that is not a slash, followed by an even number
          // of slashes then a " then end => ending on an unescaped "
          if (/[^\\](\\\\)*"$/.test(n)) {
            collect += n.trimRight().slice(0, -1)
            break
          } else {
            collect += n
          }
        }
        out[o++] = collect
      } else {
        out[o++] = chunk.trim()
      }
    }
    return out
  }

  toString () {
    return prefix + [...new Set([...this.entries.values()])]
      .map(e => e.toString())
      .sort(localeCompare).join('\n\n') + '\n'
  }

  fromTree (tree) {
    this.entries = new Map()
    // walk the tree in a deterministic order, breadth-first, alphabetical
    breadth({
      tree,
      visit: node => this.addEntryFromNode(node),
      getChildren: node => [...node.children.values(), ...node.fsChildren]
        .sort((a, b) => a.depth - b.depth || localeCompare(a.name, b.name)),
    })
    return this
  }

  addEntryFromNode (node) {
    const specs = [...node.edgesIn]
      .map(e => `${node.name}@${e.spec}`)
      .sort(localeCompare)

    // Note:
    // yarn will do excessive duplication in a case like this:
    // root -> (x@1.x, y@1.x, z@1.x)
    // y@1.x -> (x@1.1, z@2.x)
    // z@1.x -> ()
    // z@2.x -> (x@1.x)
    //
    // where x@1.2 exists, because the "x@1.x" spec will *always* resolve
    // to x@1.2, which doesn't work for y's dep on x@1.1, so you'll get this:
    //
    // root
    // +-- x@1.2.0
    // +-- y
    // |   +-- x@1.1.0
    // |   +-- z@2
    // |       +-- x@1.2.0
    // +-- z@1
    //
    // instead of this more deduped tree that arborist builds by default:
    //
    // root
    // +-- x@1.2.0 (dep is x@1.x, from root)
    // +-- y
    // |   +-- x@1.1.0
    // |   +-- z@2 (dep on x@1.x deduped to x@1.1.0 under y)
    // +-- z@1
    //
    // In order to not create an invalid yarn.lock file with conflicting
    // entries, AND not tell yarn to create an invalid tree, we need to
    // ignore the x@1.x spec coming from z, since it's already in the entries.
    //
    // So, if the integrity and resolved don't match a previous entry, skip it.
    // We call this method on shallower nodes first, so this is fine.
    const n = this.entryDataFromNode(node)
    let priorEntry = null
    const newSpecs = []
    for (const s of specs) {
      const prev = this.entries.get(s)
      // no previous entry for this spec at all, so it's new
      if (!prev) {
        // if we saw a match already, then assign this spec to it as well
        if (priorEntry) {
          priorEntry.addSpec(s)
        } else {
          newSpecs.push(s)
        }
        continue
      }

      const m = match(prev, n)
      // there was a prior entry, but a different thing.  skip this one
      if (!m) {
        continue
      }

      // previous matches, but first time seeing it, so already has this spec.
      // go ahead and add all the previously unseen specs, though
      if (!priorEntry) {
        priorEntry = prev
        for (const s of newSpecs) {
          priorEntry.addSpec(s)
          this.entries.set(s, priorEntry)
        }
        newSpecs.length = 0
        continue
      }

      // have a prior entry matching n, and matching the prev we just saw
      // add the spec to it
      priorEntry.addSpec(s)
      this.entries.set(s, priorEntry)
    }

    // if we never found a matching prior, then this is a whole new thing
    if (!priorEntry) {
      const entry = Object.assign(new YarnLockEntry(newSpecs), n)
      for (const s of newSpecs) {
        this.entries.set(s, entry)
      }
    } else {
      // pick up any new info that we got for this node, so that we can
      // decorate with integrity/resolved/etc.
      Object.assign(priorEntry, n)
    }
  }

  entryDataFromNode (node) {
    const n = {}
    if (node.package.dependencies) {
      n.dependencies = node.package.dependencies
    }
    if (node.package.optionalDependencies) {
      n.optionalDependencies = node.package.optionalDependencies
    }
    if (node.version) {
      n.version = node.version
    }
    if (node.resolved) {
      n.resolved = consistentResolve(
        node.resolved,
        node.isLink ? dirname(node.path) : node.path,
        node.root.path,
        true
      )
    }
    if (node.integrity) {
      n.integrity = node.integrity
    }

    return n
  }

  static get Entry () {
    return YarnLockEntry
  }
}

const _specs = Symbol('_specs')
class YarnLockEntry {
  constructor (specs) {
    this[_specs] = new Set(specs)
    this.resolved = null
    this.version = null
    this.integrity = null
    this.dependencies = null
    this.optionalDependencies = null
  }

  toString () {
    // sort objects to the bottom, then alphabetical
    return ([...this[_specs]]
      .sort(localeCompare)
      .map(JSON.stringify).join(', ') +
      ':\n' +
      Object.getOwnPropertyNames(this)
        .filter(prop => this[prop] !== null)
        .sort(
          (a, b) =>
          /* istanbul ignore next - sort call order is unpredictable */
            (typeof this[a] === 'object') === (typeof this[b] === 'object')
              ? localeCompare(a, b)
              : typeof this[a] === 'object' ? 1 : -1)
        .map(prop =>
          typeof this[prop] !== 'object'
            ? `  ${JSON.stringify(prop)} ${JSON.stringify(this[prop])}\n`
            : Object.keys(this[prop]).length === 0 ? ''
            : `  ${prop}:\n` + sortKV(this[prop]) + '\n')
        .join('')).trim()
  }

  addSpec (spec) {
    this[_specs].add(spec)
  }
}

module.exports = YarnLock

}, function(modId) { var map = {"./consistent-resolve.js":1653046641905}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641911, function(require, module, exports) {
const npa = require('npm-package-arg')

// extracted from npm v6 lib/install/realize-shrinkwrap-specifier.js
const specFromLock = (name, lock, where) => {
  try {
    if (lock.version) {
      const spec = npa.resolve(name, lock.version, where)
      if (lock.integrity || spec.type === 'git') {
        return spec
      }
    }
    if (lock.from) {
      // legacy metadata includes "from", but not integrity
      const spec = npa.resolve(name, lock.from, where)
      if (spec.registry && lock.version) {
        return npa.resolve(name, lock.version, where)
      } else if (!lock.resolved) {
        return spec
      }
    }
    if (lock.resolved) {
      return npa.resolve(name, lock.resolved, where)
    }
  } catch (_) { }
  try {
    return npa.resolve(name, lock.version, where)
  } catch (_) {
    return {}
  }
}

module.exports = specFromLock

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641912, function(require, module, exports) {
/* eslint node/no-deprecated-api: "off" */
const semver = require('semver')
const { basename } = require('path')
const { parse } = require('url')
module.exports = (name, tgz) => {
  const base = basename(tgz)
  if (!base.endsWith('.tgz')) {
    return null
  }

  const u = parse(tgz)
  if (/^https?:/.test(u.protocol)) {
    // registry url?  check for most likely pattern.
    // either /@foo/bar/-/bar-1.2.3.tgz or
    // /foo/-/foo-1.2.3.tgz, and fall through to
    // basename checking.  Note that registries can
    // be mounted below the root url, so /a/b/-/x/y/foo/-/foo-1.2.3.tgz
    // is a potential option.
    const tfsplit = u.path.substr(1).split('/-/')
    if (tfsplit.length > 1) {
      const afterTF = tfsplit.pop()
      if (afterTF === base) {
        const pre = tfsplit.pop()
        const preSplit = pre.split(/\/|%2f/i)
        const project = preSplit.pop()
        const scope = preSplit.pop()
        return versionFromBaseScopeName(base, scope, project)
      }
    }
  }

  const split = name.split(/\/|%2f/i)
  const project = split.pop()
  const scope = split.pop()
  return versionFromBaseScopeName(base, scope, project)
}

const versionFromBaseScopeName = (base, scope, name) => {
  if (!base.startsWith(name + '-')) {
    return null
  }

  const parsed = semver.parse(base.substring(name.length + 1, base.length - 4))
  return parsed ? {
    name: scope && scope.charAt(0) === '@' ? `${scope}/${name}` : name,
    version: parsed.version,
  } : null
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641913, function(require, module, exports) {
// when an optional dep fails to install, we need to remove the branch of the
// graph up to the first optionalDependencies, as well as any nodes that are
// only required by other nodes in the set.
//
// This function finds the set of nodes that will need to be removed in that
// case.
//
// Note that this is *only* going to work with trees where calcDepFlags
// has been called, because we rely on the node.optional flag.

const gatherDepSet = require('./gather-dep-set.js')
const optionalSet = node => {
  if (!node.optional) {
    return new Set()
  }

  // start with the node, then walk up the dependency graph until we
  // get to the boundaries that define the optional set.  since the
  // node is optional, we know that all paths INTO this area of the
  // graph are optional, but there may be non-optional dependencies
  // WITHIN the area.
  const set = new Set([node])
  for (const node of set) {
    for (const edge of node.edgesIn) {
      if (!edge.optional) {
        set.add(edge.from)
      }
    }
  }

  // now that we've hit the boundary, gather the rest of the nodes in
  // the optional section.  that's the set of dependencies that are only
  // depended upon by other nodes within the set, or optional dependencies
  // from outside the set.
  return gatherDepSet(set, edge => !edge.optional)
}

module.exports = optionalSet

}, function(modId) { var map = {"./gather-dep-set.js":1653046641904}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641914, function(require, module, exports) {
// Sometimes we need to actually do a walk from the root, because you can
// have a cycle of deps that all depend on each other, but no path from root.
// Also, since the ideal tree is loaded from the shrinkwrap, it had extraneous
// flags set false that might now be actually extraneous, and dev/optional
// flags that are also now incorrect.  This method sets all flags to true, so
// we can find the set that is actually extraneous.
module.exports = tree => {
  for (const node of tree.inventory.values()) {
    node.extraneous = true
    node.dev = true
    node.devOptional = true
    node.peer = true
    node.optional = true
  }
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641915, function(require, module, exports) {
const mapWorkspaces = require('@npmcli/map-workspaces')

const _appendWorkspaces = Symbol('appendWorkspaces')
// shared ref used by other mixins/Arborist
const _loadWorkspaces = Symbol.for('loadWorkspaces')
const _loadWorkspacesVirtual = Symbol.for('loadWorkspacesVirtual')

module.exports = cls => class MapWorkspaces extends cls {
  [_appendWorkspaces] (node, workspaces) {
    if (node && workspaces.size) {
      node.workspaces = workspaces
    }

    return node
  }

  async [_loadWorkspaces] (node) {
    if (node.workspaces) {
      return node
    }

    const workspaces = await mapWorkspaces({
      cwd: node.path,
      pkg: node.package,
    })

    return this[_appendWorkspaces](node, workspaces)
  }

  [_loadWorkspacesVirtual] (opts) {
    return mapWorkspaces.virtual(opts)
  }
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641916, function(require, module, exports) {
// mix-in implementing the loadActual method

const { relative, dirname, resolve, join, normalize } = require('path')

const rpj = require('read-package-json-fast')
const { promisify } = require('util')
const readdir = promisify(require('readdir-scoped-modules'))
const walkUp = require('walk-up-path')
const ancestorPath = require('common-ancestor-path')
const treeCheck = require('../tree-check.js')

const Shrinkwrap = require('../shrinkwrap.js')
const calcDepFlags = require('../calc-dep-flags.js')
const Node = require('../node.js')
const Link = require('../link.js')
const realpath = require('../realpath.js')

const _loadFSNode = Symbol('loadFSNode')
const _newNode = Symbol('newNode')
const _newLink = Symbol('newLink')
const _loadFSTree = Symbol('loadFSTree')
const _loadFSChildren = Symbol('loadFSChildren')
const _findMissingEdges = Symbol('findMissingEdges')
const _findFSParents = Symbol('findFSParents')
const _resetDepFlags = Symbol('resetDepFlags')

const _actualTreeLoaded = Symbol('actualTreeLoaded')
const _rpcache = Symbol.for('realpathCache')
const _stcache = Symbol.for('statCache')
const _topNodes = Symbol('linkTargets')
const _cache = Symbol('nodeLoadingCache')
const _loadActual = Symbol('loadActual')
const _loadActualVirtually = Symbol('loadActualVirtually')
const _loadActualActually = Symbol('loadActualActually')
const _loadWorkspaces = Symbol.for('loadWorkspaces')
const _loadWorkspaceTargets = Symbol('loadWorkspaceTargets')
const _actualTreePromise = Symbol('actualTreePromise')
const _actualTree = Symbol('actualTree')
const _transplant = Symbol('transplant')
const _transplantFilter = Symbol('transplantFilter')

const _filter = Symbol('filter')
const _global = Symbol.for('global')
const _changePath = Symbol.for('_changePath')

module.exports = cls => class ActualLoader extends cls {
  constructor (options) {
    super(options)

    this[_global] = !!options.global

    // the tree of nodes on disk
    this.actualTree = options.actualTree

    // ensure when walking the tree that we don't call loadTree on the
    // same actual node more than one time.
    this[_actualTreeLoaded] = new Set()

    // caches for cached realpath calls
    const cwd = process.cwd()
    // assume that the cwd is real enough for our purposes
    this[_rpcache] = new Map([[cwd, cwd]])
    this[_stcache] = new Map()

    // cache of nodes when loading the actualTree, so that we avoid
    // loaded the same node multiple times when symlinks attack.
    this[_cache] = new Map()

    // cache of link targets for setting fsParent links
    // We don't do fsParent as a magic getter/setter, because
    // it'd be too costly to keep up to date along the walk.
    // And, we know that it can ONLY be relevant when the node
    // is a target of a link, otherwise it'd be in a node_modules
    // folder, so take advantage of that to limit the scans later.
    this[_topNodes] = new Set()
  }

  [_resetDepFlags] (tree, root) {
    // reset all deps to extraneous prior to recalc
    if (!root) {
      for (const node of tree.inventory.values()) {
        node.extraneous = true
      }
    }

    // only reset root flags if we're not re-rooting,
    // otherwise leave as-is
    calcDepFlags(tree, !root)
    return tree
  }

  // public method
  async loadActual (options = {}) {
    // allow the user to set options on the ctor as well.
    // XXX: deprecate separate method options objects.
    options = { ...this.options, ...options }

    // stash the promise so that we don't ever have more than one
    // going at the same time.  This is so that buildIdealTree can
    // default to the actualTree if no shrinkwrap present, but
    // reify() can still call buildIdealTree and loadActual in parallel
    // safely.
    return this.actualTree ? this.actualTree
      : this[_actualTreePromise] ? this[_actualTreePromise]
      : this[_actualTreePromise] = this[_loadActual](options)
        .then(tree => this[_resetDepFlags](tree, options.root))
        .then(tree => this.actualTree = treeCheck(tree))
  }

  async [_loadActual] (options) {
    // mostly realpath to throw if the root doesn't exist
    const {
      global = false,
      filter = () => true,
      root = null,
      transplantFilter = () => true,
      ignoreMissing = false,
    } = options
    this[_filter] = filter
    this[_transplantFilter] = transplantFilter

    if (global) {
      const real = await realpath(this.path, this[_rpcache], this[_stcache])
      const newNodeOrLink = this.path === real ? _newNode : _newLink
      this[_actualTree] = await this[newNodeOrLink]({
        path: this.path,
        realpath: real,
        pkg: {},
        global,
        loadOverrides: true,
      })
      return this[_loadActualActually]({ root, ignoreMissing, global })
    }

    // not in global mode, hidden lockfile is allowed, load root pkg too
    this[_actualTree] = await this[_loadFSNode]({
      path: this.path,
      real: await realpath(this.path, this[_rpcache], this[_stcache]),
      loadOverrides: true,
    })

    this[_actualTree].assertRootOverrides()

    // Note: hidden lockfile will be rejected if it's not the latest thing
    // in the folder, or if any of the entries in the hidden lockfile are
    // missing.
    const meta = await Shrinkwrap.load({
      path: this[_actualTree].path,
      hiddenLockfile: true,
    })
    if (meta.loadedFromDisk) {
      this[_actualTree].meta = meta
      return this[_loadActualVirtually]({ root })
    } else {
      const meta = await Shrinkwrap.load({
        path: this[_actualTree].path,
        lockfileVersion: this.options.lockfileVersion,
      })
      this[_actualTree].meta = meta
      return this[_loadActualActually]({ root, ignoreMissing })
    }
  }

  async [_loadActualVirtually] ({ root }) {
    // have to load on a new Arborist object, so we don't assign
    // the virtualTree on this one!  Also, the weird reference is because
    // we can't easily get a ref to Arborist in this module, without
    // creating a circular reference, since this class is a mixin used
    // to build up the Arborist class itself.
    await new this.constructor({ ...this.options }).loadVirtual({
      root: this[_actualTree],
    })
    await this[_loadWorkspaces](this[_actualTree])

    this[_transplant](root)
    return this[_actualTree]
  }

  async [_loadActualActually] ({ root, ignoreMissing, global }) {
    await this[_loadFSTree](this[_actualTree])
    await this[_loadWorkspaces](this[_actualTree])
    await this[_loadWorkspaceTargets](this[_actualTree])
    if (!ignoreMissing) {
      await this[_findMissingEdges]()
    }
    this[_findFSParents]()
    this[_transplant](root)

    if (global) {
      // need to depend on the children, or else all of them
      // will end up being flagged as extraneous, since the
      // global root isn't a "real" project
      const tree = this[_actualTree]
      const actualRoot = tree.isLink ? tree.target : tree
      const { dependencies = {} } = actualRoot.package
      for (const [name, kid] of actualRoot.children.entries()) {
        const def = kid.isLink ? `file:${kid.realpath}` : '*'
        dependencies[name] = dependencies[name] || def
      }
      actualRoot.package = { ...actualRoot.package, dependencies }
    }
    return this[_actualTree]
  }

  // if there are workspace targets without Link nodes created, load
  // the targets, so that we know what they are.
  async [_loadWorkspaceTargets] (tree) {
    if (!tree.workspaces || !tree.workspaces.size) {
      return
    }

    const promises = []
    for (const path of tree.workspaces.values()) {
      if (!this[_cache].has(path)) {
        // workspace overrides use the root overrides
        const p = this[_loadFSNode]({ path, root: this[_actualTree], useRootOverrides: true })
          .then(node => this[_loadFSTree](node))
        promises.push(p)
      }
    }
    await Promise.all(promises)
  }

  [_transplant] (root) {
    if (!root || root === this[_actualTree]) {
      return
    }

    this[_actualTree][_changePath](root.path)
    for (const node of this[_actualTree].children.values()) {
      if (!this[_transplantFilter](node)) {
        node.root = null
      }
    }

    root.replace(this[_actualTree])
    for (const node of this[_actualTree].fsChildren) {
      node.root = this[_transplantFilter](node) ? root : null
    }

    this[_actualTree] = root
  }

  [_loadFSNode] ({ path, parent, real, root, loadOverrides, useRootOverrides }) {
    if (!real) {
      return realpath(path, this[_rpcache], this[_stcache])
        .then(
          real => this[_loadFSNode]({
            path,
            parent,
            real,
            root,
            loadOverrides,
            useRootOverrides,
          }),
          // if realpath fails, just provide a dummy error node
          error => new Node({
            error,
            path,
            realpath: path,
            parent,
            root,
            loadOverrides,
          })
        )
    }

    // cache temporarily holds a promise placeholder so we don't try to create
    // the same node multiple times.  this is rare to encounter, given the
    // aggressive caching on realpath and lstat calls, but it's possible that
    // it's already loaded as a tree top, and then gets its parent loaded
    // later, if a symlink points deeper in the tree.
    const cached = this[_cache].get(path)
    if (cached && !cached.dummy) {
      return Promise.resolve(cached).then(node => {
        node.parent = parent
        return node
      })
    }

    const p = rpj(join(real, 'package.json'))
      // soldier on if read-package-json raises an error
      .then(pkg => [pkg, null], error => [null, error])
      .then(([pkg, error]) => {
        return this[normalize(path) === real ? _newNode : _newLink]({
          legacyPeerDeps: this.legacyPeerDeps,
          path,
          realpath: real,
          pkg,
          error,
          parent,
          root,
          loadOverrides,
          ...(useRootOverrides && root.overrides
            ? { overrides: root.overrides.getNodeRule({ name: pkg.name, version: pkg.version }) }
            : {}),
        })
      })
      .then(node => {
        this[_cache].set(path, node)
        return node
      })

    this[_cache].set(path, p)
    return p
  }

  // this is the way it is to expose a timing issue which is difficult to
  // test otherwise.  The creation of a Node may take slightly longer than
  // the creation of a Link that targets it.  If the Node has _begun_ its
  // creation phase (and put a Promise in the cache) then the Link will
  // get a Promise as its cachedTarget instead of an actual Node object.
  // This is not a problem, because it gets resolved prior to returning
  // the tree or attempting to load children.  However, it IS remarkably
  // difficult to get to happen in a test environment to verify reliably.
  // Hence this kludge.
  [_newNode] (options) {
    // check it for an fsParent if it's a tree top.  there's a decent chance
    // it'll get parented later, making the fsParent scan a no-op, but better
    // safe than sorry, since it's cheap.
    const { parent, realpath } = options
    if (!parent) {
      this[_topNodes].add(realpath)
    }
    return process.env._TEST_ARBORIST_SLOW_LINK_TARGET_ === '1'
      ? new Promise(res => setTimeout(() => res(new Node(options)), 100))
      : new Node(options)
  }

  [_newLink] (options) {
    const { realpath } = options
    this[_topNodes].add(realpath)
    const target = this[_cache].get(realpath)
    const link = new Link({ ...options, target })

    if (!target) {
      this[_cache].set(realpath, link.target)
      // if a link target points at a node outside of the root tree's
      // node_modules hierarchy, then load that node as well.
      return this[_loadFSTree](link.target).then(() => link)
    } else if (target.then) {
      target.then(node => link.target = node)
    }

    return link
  }

  [_loadFSTree] (node) {
    const did = this[_actualTreeLoaded]
    node = node.target

    // if a Link target has started, but not completed, then
    // a Promise will be in the cache to indicate this.
    if (node.then) {
      return node.then(node => this[_loadFSTree](node))
    }

    // impossible except in pathological ELOOP cases
    /* istanbul ignore if */
    if (did.has(node.realpath)) {
      return Promise.resolve(node)
    }

    did.add(node.realpath)
    return this[_loadFSChildren](node)
      .then(() => Promise.all(
        [...node.children.entries()]
          .filter(([name, kid]) => !did.has(kid.realpath))
          .map(([name, kid]) => this[_loadFSTree](kid))))
  }

  // create child nodes for all the entries in node_modules
  // and attach them to the node as a parent
  [_loadFSChildren] (node) {
    const nm = resolve(node.realpath, 'node_modules')
    return readdir(nm).then(kids => {
      return Promise.all(
      // ignore . dirs and retired scoped package folders
        kids.filter(kid => !/^(@[^/]+\/)?\./.test(kid))
          .filter(kid => this[_filter](node, kid))
          .map(kid => this[_loadFSNode]({
            parent: node,
            path: resolve(nm, kid),
          })))
    },
    // error in the readdir is not fatal, just means no kids
    () => {})
  }

  async [_findMissingEdges] () {
    // try to resolve any missing edges by walking up the directory tree,
    // checking for the package in each node_modules folder.  stop at the
    // root directory.
    // The tricky move here is that we load a "dummy" node for the folder
    // containing the node_modules folder, so that it can be assigned as
    // the fsParent.  It's a bad idea to *actually* load that full node,
    // because people sometimes develop in ~/projects/node_modules/...
    // so we'd end up loading a massive tree with lots of unrelated junk.
    const nmContents = new Map()
    const tree = this[_actualTree]
    for (const node of tree.inventory.values()) {
      const ancestor = ancestorPath(node.realpath, this.path)

      const depPromises = []
      for (const [name, edge] of node.edgesOut.entries()) {
        const notMissing = !edge.missing &&
          !(edge.to && (edge.to.dummy || edge.to.parent !== node))
        if (notMissing) {
          continue
        }

        // start the walk from the dirname, because we would have found
        // the dep in the loadFSTree step already if it was local.
        for (const p of walkUp(dirname(node.realpath))) {
          // only walk as far as the nearest ancestor
          // this keeps us from going into completely unrelated
          // places when a project is just missing something, but
          // allows for finding the transitive deps of link targets.
          // ie, if it has to go up and back out to get to the path
          // from the nearest common ancestor, we've gone too far.
          if (ancestor && /^\.\.(?:[\\/]|$)/.test(relative(ancestor, p))) {
            break
          }

          const entries = nmContents.get(p) ||
            await readdir(p + '/node_modules').catch(() => [])
          nmContents.set(p, entries)
          if (!entries.includes(name)) {
            continue
          }

          const d = this[_cache].has(p) ? await this[_cache].get(p)
            : new Node({ path: p, root: node.root, dummy: true })
          this[_cache].set(p, d)
          if (d.dummy) {
            // it's a placeholder, so likely would not have loaded this dep,
            // unless another dep in the tree also needs it.
            const depPath = normalize(`${p}/node_modules/${name}`)
            const cached = this[_cache].get(depPath)
            if (!cached || cached.dummy) {
              depPromises.push(this[_loadFSNode]({
                path: depPath,
                root: node.root,
                parent: d,
              }).then(node => this[_loadFSTree](node)))
            }
          }
          break
        }
      }
      await Promise.all(depPromises)
    }
  }

  // try to find a node that is the parent in a fs tree sense, but not a
  // node_modules tree sense, of any link targets.  this allows us to
  // resolve deps that node will find, but a legacy npm view of the
  // world would not have noticed.
  [_findFSParents] () {
    for (const path of this[_topNodes]) {
      const node = this[_cache].get(path)
      if (node && !node.parent && !node.fsParent) {
        for (const p of walkUp(dirname(path))) {
          if (this[_cache].has(p)) {
            node.fsParent = this[_cache].get(p)
            break
          }
        }
      }
    }
  }
}

}, function(modId) { var map = {"../tree-check.js":1653046641890,"../shrinkwrap.js":1653046641909,"../calc-dep-flags.js":1653046641908,"../node.js":1653046641898,"../link.js":1653046641896,"../realpath.js":1653046641889}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641917, function(require, module, exports) {
// mixin providing the loadVirtual method
const localeCompare = require('@isaacs/string-locale-compare')('en')

const { resolve } = require('path')

const nameFromFolder = require('@npmcli/name-from-folder')
const consistentResolve = require('../consistent-resolve.js')
const Shrinkwrap = require('../shrinkwrap.js')
const Node = require('../node.js')
const Link = require('../link.js')
const relpath = require('../relpath.js')
const calcDepFlags = require('../calc-dep-flags.js')
const rpj = require('read-package-json-fast')
const treeCheck = require('../tree-check.js')

const loadFromShrinkwrap = Symbol('loadFromShrinkwrap')
const resolveNodes = Symbol('resolveNodes')
const resolveLinks = Symbol('resolveLinks')
const assignBundles = Symbol('assignBundles')
const loadRoot = Symbol('loadRoot')
const loadNode = Symbol('loadVirtualNode')
const loadLink = Symbol('loadVirtualLink')
const loadWorkspaces = Symbol.for('loadWorkspaces')
const loadWorkspacesVirtual = Symbol.for('loadWorkspacesVirtual')
const flagsSuspect = Symbol.for('flagsSuspect')
const reCalcDepFlags = Symbol('reCalcDepFlags')
const checkRootEdges = Symbol('checkRootEdges')
const rootOptionProvided = Symbol('rootOptionProvided')

const depsToEdges = (type, deps) =>
  Object.entries(deps).map(d => [type, ...d])

module.exports = cls => class VirtualLoader extends cls {
  constructor (options) {
    super(options)

    // the virtual tree we load from a shrinkwrap
    this.virtualTree = options.virtualTree
    this[flagsSuspect] = false
  }

  // public method
  async loadVirtual (options = {}) {
    if (this.virtualTree) {
      return this.virtualTree
    }

    // allow the user to set reify options on the ctor as well.
    // XXX: deprecate separate reify() options object.
    options = { ...this.options, ...options }

    if (options.root && options.root.meta) {
      await this[loadFromShrinkwrap](options.root.meta, options.root)
      return treeCheck(this.virtualTree)
    }

    const s = await Shrinkwrap.load({
      path: this.path,
      lockfileVersion: this.options.lockfileVersion,
    })
    if (!s.loadedFromDisk && !options.root) {
      const er = new Error('loadVirtual requires existing shrinkwrap file')
      throw Object.assign(er, { code: 'ENOLOCK' })
    }

    // when building the ideal tree, we pass in a root node to this function
    // otherwise, load it from the root package json or the lockfile
    const {
      root = await this[loadRoot](s),
    } = options

    this[rootOptionProvided] = options.root

    await this[loadFromShrinkwrap](s, root)
    root.assertRootOverrides()
    return treeCheck(this.virtualTree)
  }

  async [loadRoot] (s) {
    const pj = this.path + '/package.json'
    const pkg = await rpj(pj).catch(() => s.data.packages['']) || {}
    return this[loadWorkspaces](this[loadNode]('', pkg))
  }

  async [loadFromShrinkwrap] (s, root) {
    if (!this[rootOptionProvided]) {
      // root is never any of these things, but might be a brand new
      // baby Node object that never had its dep flags calculated.
      root.extraneous = false
      root.dev = false
      root.optional = false
      root.devOptional = false
      root.peer = false
    } else {
      this[flagsSuspect] = true
    }

    this[checkRootEdges](s, root)
    root.meta = s
    this.virtualTree = root
    const { links, nodes } = this[resolveNodes](s, root)
    await this[resolveLinks](links, nodes)
    if (!(s.originalLockfileVersion >= 2)) {
      this[assignBundles](nodes)
    }
    if (this[flagsSuspect]) {
      this[reCalcDepFlags](nodes.values())
    }
    return root
  }

  [reCalcDepFlags] (nodes) {
    // reset all dep flags
    // can't use inventory here, because virtualTree might not be root
    for (const node of nodes) {
      if (node.isRoot || node === this[rootOptionProvided]) {
        continue
      }
      node.extraneous = true
      node.dev = true
      node.optional = true
      node.devOptional = true
      node.peer = true
    }
    calcDepFlags(this.virtualTree, !this[rootOptionProvided])
  }

  // check the lockfile deps, and see if they match.  if they do not
  // then we have to reset dep flags at the end.  for example, if the
  // user manually edits their package.json file, then we need to know
  // that the idealTree is no longer entirely trustworthy.
  [checkRootEdges] (s, root) {
    // loaded virtually from tree, no chance of being out of sync
    // ancient lockfiles are critically damaged by this process,
    // so we need to just hope for the best in those cases.
    if (!s.loadedFromDisk || s.ancientLockfile) {
      return
    }

    const lock = s.get('')
    const prod = lock.dependencies || {}
    const dev = lock.devDependencies || {}
    const optional = lock.optionalDependencies || {}
    const peer = lock.peerDependencies || {}
    const peerOptional = {}
    if (lock.peerDependenciesMeta) {
      for (const [name, meta] of Object.entries(lock.peerDependenciesMeta)) {
        if (meta.optional && peer[name] !== undefined) {
          peerOptional[name] = peer[name]
          delete peer[name]
        }
      }
    }
    for (const name of Object.keys(optional)) {
      delete prod[name]
    }

    const lockWS = []
    const workspaces = this[loadWorkspacesVirtual]({
      cwd: this.path,
      lockfile: s.data,
    })
    for (const [name, path] of workspaces.entries()) {
      lockWS.push(['workspace', name, `file:${path}`])
    }

    const lockEdges = [
      ...depsToEdges('prod', prod),
      ...depsToEdges('dev', dev),
      ...depsToEdges('optional', optional),
      ...depsToEdges('peer', peer),
      ...depsToEdges('peerOptional', peerOptional),
      ...lockWS,
    ].sort(([atype, aname], [btype, bname]) =>
      localeCompare(atype, btype) || localeCompare(aname, bname))

    const rootEdges = [...root.edgesOut.values()]
      .map(e => [e.type, e.name, e.spec])
      .sort(([atype, aname], [btype, bname]) =>
        localeCompare(atype, btype) || localeCompare(aname, bname))

    if (rootEdges.length !== lockEdges.length) {
      // something added or removed
      return this[flagsSuspect] = true
    }

    for (let i = 0; i < lockEdges.length; i++) {
      if (rootEdges[i][0] !== lockEdges[i][0] ||
          rootEdges[i][1] !== lockEdges[i][1] ||
          rootEdges[i][2] !== lockEdges[i][2]) {
        return this[flagsSuspect] = true
      }
    }
  }

  // separate out link metadatas, and create Node objects for nodes
  [resolveNodes] (s, root) {
    const links = new Map()
    const nodes = new Map([['', root]])
    for (const [location, meta] of Object.entries(s.data.packages)) {
      // skip the root because we already got it
      if (!location) {
        continue
      }

      if (meta.link) {
        links.set(location, meta)
      } else {
        nodes.set(location, this[loadNode](location, meta))
      }
    }
    return { links, nodes }
  }

  // links is the set of metadata, and nodes is the map of non-Link nodes
  // Set the targets to nodes in the set, if we have them (we might not)
  async [resolveLinks] (links, nodes) {
    for (const [location, meta] of links.entries()) {
      const targetPath = resolve(this.path, meta.resolved)
      const targetLoc = relpath(this.path, targetPath)
      const target = nodes.get(targetLoc)
      const link = this[loadLink](location, targetLoc, target, meta)
      nodes.set(location, link)
      nodes.set(targetLoc, link.target)

      // we always need to read the package.json for link targets
      // outside node_modules because they can be changed by the local user
      if (!link.target.parent) {
        const pj = link.realpath + '/package.json'
        const pkg = await rpj(pj).catch(() => null)
        if (pkg) {
          link.target.package = pkg
        }
      }
    }
  }

  [assignBundles] (nodes) {
    for (const [location, node] of nodes) {
      // Skip assignment of parentage for the root package
      if (!location || node.isLink && !node.target.location) {
        continue
      }
      const { name, parent, package: { inBundle } } = node

      if (!parent) {
        continue
      }

      // read inBundle from package because 'package' here is
      // actually a v2 lockfile metadata entry.
      // If the *parent* is also bundled, though, or if the parent has
      // no dependency on it, then we assume that it's being pulled in
      // just by virtue of its parent or a transitive dep being bundled.
      const { package: ppkg } = parent
      const { inBundle: parentBundled } = ppkg
      if (inBundle && !parentBundled && parent.edgesOut.has(node.name)) {
        if (!ppkg.bundleDependencies) {
          ppkg.bundleDependencies = [name]
        } else {
          ppkg.bundleDependencies.push(name)
        }
      }
    }
  }

  [loadNode] (location, sw) {
    const p = this.virtualTree ? this.virtualTree.realpath : this.path
    const path = resolve(p, location)
    // shrinkwrap doesn't include package name unless necessary
    if (!sw.name) {
      sw.name = nameFromFolder(path)
    }

    const dev = sw.dev
    const optional = sw.optional
    const devOptional = dev || optional || sw.devOptional
    const peer = sw.peer

    const node = new Node({
      legacyPeerDeps: this.legacyPeerDeps,
      root: this.virtualTree,
      path,
      realpath: path,
      integrity: sw.integrity,
      resolved: consistentResolve(sw.resolved, this.path, path),
      pkg: sw,
      hasShrinkwrap: sw.hasShrinkwrap,
      dev,
      optional,
      devOptional,
      peer,
    })
    // cast to boolean because they're undefined in the lock file when false
    node.extraneous = !!sw.extraneous
    node.devOptional = !!(sw.devOptional || sw.dev || sw.optional)
    node.peer = !!sw.peer
    node.optional = !!sw.optional
    node.dev = !!sw.dev
    return node
  }

  [loadLink] (location, targetLoc, target, meta) {
    const path = resolve(this.path, location)
    const link = new Link({
      legacyPeerDeps: this.legacyPeerDeps,
      path,
      realpath: resolve(this.path, targetLoc),
      target,
      pkg: target && target.package,
    })
    link.extraneous = target.extraneous
    link.devOptional = target.devOptional
    link.peer = target.peer
    link.optional = target.optional
    link.dev = target.dev
    return link
  }
}

}, function(modId) { var map = {"../consistent-resolve.js":1653046641905,"../shrinkwrap.js":1653046641909,"../node.js":1653046641898,"../link.js":1653046641896,"../relpath.js":1653046641897,"../calc-dep-flags.js":1653046641908,"../tree-check.js":1653046641890}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641918, function(require, module, exports) {
// Arborist.rebuild({path = this.path}) will do all the binlinks and
// bundle building needed.  Called by reify, and by `npm rebuild`.

const localeCompare = require('@isaacs/string-locale-compare')('en')
const { depth: dfwalk } = require('treeverse')
const promiseAllRejectLate = require('promise-all-reject-late')
const rpj = require('read-package-json-fast')
const binLinks = require('bin-links')
const runScript = require('@npmcli/run-script')
const promiseCallLimit = require('promise-call-limit')
const { resolve } = require('path')
const {
  isNodeGypPackage,
  defaultGypInstallScript,
} = require('@npmcli/node-gyp')
const log = require('proc-log')

const boolEnv = b => b ? '1' : ''
const sortNodes = (a, b) =>
  (a.depth - b.depth) || localeCompare(a.path, b.path)

const _workspaces = Symbol.for('workspaces')
const _build = Symbol('build')
const _resetQueues = Symbol('resetQueues')
const _rebuildBundle = Symbol('rebuildBundle')
const _ignoreScripts = Symbol('ignoreScripts')
const _binLinks = Symbol('binLinks')
const _oldMeta = Symbol('oldMeta')
const _createBinLinks = Symbol('createBinLinks')
const _doHandleOptionalFailure = Symbol('doHandleOptionalFailure')
const _linkAllBins = Symbol('linkAllBins')
const _runScripts = Symbol('runScripts')
const _buildQueues = Symbol('buildQueues')
const _addToBuildSet = Symbol('addToBuildSet')
const _checkBins = Symbol.for('checkBins')
const _queues = Symbol('queues')
const _scriptShell = Symbol('scriptShell')
const _includeWorkspaceRoot = Symbol.for('includeWorkspaceRoot')
const _workspacesEnabled = Symbol.for('workspacesEnabled')

const _force = Symbol.for('force')

// defined by reify mixin
const _handleOptionalFailure = Symbol.for('handleOptionalFailure')
const _trashList = Symbol.for('trashList')

module.exports = cls => class Builder extends cls {
  constructor (options) {
    super(options)

    const {
      ignoreScripts = false,
      scriptShell,
      binLinks = true,
      rebuildBundle = true,
    } = options

    this.scriptsRun = new Set()
    this[_binLinks] = binLinks
    this[_ignoreScripts] = !!ignoreScripts
    this[_scriptShell] = scriptShell
    this[_rebuildBundle] = !!rebuildBundle
    this[_resetQueues]()
    this[_oldMeta] = null
  }

  async rebuild ({ nodes, handleOptionalFailure = false } = {}) {
    // nothing to do if we're not building anything!
    if (this[_ignoreScripts] && !this[_binLinks]) {
      return
    }

    // when building for the first time, as part of reify, we ignore
    // failures in optional nodes, and just delete them.  however, when
    // running JUST a rebuild, we treat optional failures as real fails
    this[_doHandleOptionalFailure] = handleOptionalFailure

    // if we don't have a set of nodes, then just rebuild
    // the actual tree on disk.
    if (!nodes) {
      const tree = await this.loadActual()
      let filterSet
      if (!this[_workspacesEnabled]) {
        filterSet = this.excludeWorkspacesDependencySet(tree)
        nodes = tree.inventory.filter(node =>
          filterSet.has(node) || node.isProjectRoot
        )
      } else if (this[_workspaces] && this[_workspaces].length) {
        filterSet = this.workspaceDependencySet(
          tree,
          this[_workspaces],
          this[_includeWorkspaceRoot]
        )
        nodes = tree.inventory.filter(node => filterSet.has(node))
      } else {
        nodes = tree.inventory.values()
      }
    }

    // separates links nodes so that it can run
    // prepare scripts and link bins in the expected order
    process.emit('time', 'build')
    const depNodes = new Set()
    const linkNodes = new Set()
    for (const node of nodes) {
      // we skip the target nodes to that workspace in order to make sure
      // we only run lifecycle scripts / place bin links once per workspace
      if (node.isLink) {
        linkNodes.add(node)
      } else {
        depNodes.add(node)
      }
    }

    await this[_build](depNodes, {})

    if (linkNodes.size) {
      this[_resetQueues]()
      await this[_build](linkNodes, { type: 'links' })
    }

    process.emit('timeEnd', 'build')
  }

  [_resetQueues] () {
    this[_queues] = {
      preinstall: [],
      install: [],
      postinstall: [],
      prepare: [],
      bin: [],
    }
  }

  async [_build] (nodes, { type = 'deps' }) {
    process.emit('time', `build:${type}`)

    await this[_buildQueues](nodes)
    // links should run prepare scripts and only link bins after that
    if (type !== 'links') {
      if (!this[_ignoreScripts]) {
        await this[_runScripts]('preinstall')
      }
      if (this[_binLinks]) {
        await this[_linkAllBins]()
      }
      if (!this[_ignoreScripts]) {
        await this[_runScripts]('install')
        await this[_runScripts]('postinstall')
      }
    } else {
      await this[_runScripts]('prepare')

      if (this[_binLinks]) {
        await this[_linkAllBins]()
      }
    }

    process.emit('timeEnd', `build:${type}`)
  }

  async [_buildQueues] (nodes) {
    process.emit('time', 'build:queue')
    const set = new Set()

    const promises = []
    for (const node of nodes) {
      promises.push(this[_addToBuildSet](node, set))

      // if it has bundle deps, add those too, if rebuildBundle
      if (this[_rebuildBundle] !== false) {
        const bd = node.package.bundleDependencies
        if (bd && bd.length) {
          dfwalk({
            tree: node,
            leave: node => promises.push(this[_addToBuildSet](node, set)),
            getChildren: node => [...node.children.values()],
            filter: node => node.inBundle,
          })
        }
      }
    }
    await promiseAllRejectLate(promises)

    // now sort into the queues for the 4 things we have to do
    // run in the same predictable order that buildIdealTree uses
    // there's no particular reason for doing it in this order rather
    // than another, but sorting *somehow* makes it consistent.
    const queue = [...set].sort(sortNodes)

    for (const node of queue) {
      const { package: { bin, scripts = {} } } = node.target
      const { preinstall, install, postinstall, prepare } = scripts
      const tests = { bin, preinstall, install, postinstall, prepare }
      for (const [key, has] of Object.entries(tests)) {
        if (has) {
          this[_queues][key].push(node)
        }
      }
    }
    process.emit('timeEnd', 'build:queue')
  }

  async [_checkBins] (node) {
    // if the node is a global top, and we're not in force mode, then
    // any existing bins need to either be missing, or a symlink into
    // the node path.  Otherwise a package can have a preinstall script
    // that unlinks something, to allow them to silently overwrite system
    // binaries, which is unsafe and insecure.
    if (!node.globalTop || this[_force]) {
      return
    }
    const { path, package: pkg } = node
    await binLinks.checkBins({ pkg, path, top: true, global: true })
  }

  async [_addToBuildSet] (node, set, refreshed = false) {
    if (set.has(node)) {
      return
    }

    if (this[_oldMeta] === null) {
      const { root: { meta } } = node
      this[_oldMeta] = meta && meta.loadedFromDisk &&
        !(meta.originalLockfileVersion >= 2)
    }

    const { package: pkg, hasInstallScript } = node.target
    const { gypfile, bin, scripts = {} } = pkg

    const { preinstall, install, postinstall, prepare } = scripts
    const anyScript = preinstall || install || postinstall || prepare
    if (!refreshed && !anyScript && (hasInstallScript || this[_oldMeta])) {
      // we either have an old metadata (and thus might have scripts)
      // or we have an indication that there's install scripts (but
      // don't yet know what they are) so we have to load the package.json
      // from disk to see what the deal is.  Failure here just means
      // no scripts to add, probably borked package.json.
      // add to the set then remove while we're reading the pj, so we
      // don't accidentally hit it multiple times.
      set.add(node)
      const pkg = await rpj(node.path + '/package.json').catch(() => ({}))
      set.delete(node)

      const { scripts = {} } = pkg
      node.package.scripts = scripts
      return this[_addToBuildSet](node, set, true)
    }

    // Rebuild node-gyp dependencies lacking an install or preinstall script
    // note that 'scripts' might be missing entirely, and the package may
    // set gypfile:false to avoid this automatic detection.
    const isGyp = gypfile !== false &&
      !install &&
      !preinstall &&
      await isNodeGypPackage(node.path)

    if (bin || preinstall || install || postinstall || prepare || isGyp) {
      if (bin) {
        await this[_checkBins](node)
      }
      if (isGyp) {
        scripts.install = defaultGypInstallScript
        node.package.scripts = scripts
      }
      set.add(node)
    }
  }

  async [_runScripts] (event) {
    const queue = this[_queues][event]

    if (!queue.length) {
      return
    }

    process.emit('time', `build:run:${event}`)
    const stdio = this.options.foregroundScripts ? 'inherit' : 'pipe'
    const limit = this.options.foregroundScripts ? 1 : undefined
    await promiseCallLimit(queue.map(node => async () => {
      const {
        path,
        integrity,
        resolved,
        optional,
        peer,
        dev,
        devOptional,
        package: pkg,
        location,
      } = node.target

      // skip any that we know we'll be deleting
      if (this[_trashList].has(path)) {
        return
      }

      const timer = `build:run:${event}:${location}`
      process.emit('time', timer)
      log.info('run', pkg._id, event, location, pkg.scripts[event])
      const env = {
        npm_package_resolved: resolved,
        npm_package_integrity: integrity,
        npm_package_json: resolve(path, 'package.json'),
        npm_package_optional: boolEnv(optional),
        npm_package_dev: boolEnv(dev),
        npm_package_peer: boolEnv(peer),
        npm_package_dev_optional:
          boolEnv(devOptional && !dev && !optional),
      }
      const runOpts = {
        event,
        path,
        pkg,
        stdioString: true,
        stdio,
        env,
        scriptShell: this[_scriptShell],
      }
      const p = runScript(runOpts).catch(er => {
        const { code, signal } = er
        log.info('run', pkg._id, event, { code, signal })
        throw er
      }).then(({ args, code, signal, stdout, stderr }) => {
        this.scriptsRun.add({
          pkg,
          path,
          event,
          cmd: args && args[args.length - 1],
          env,
          code,
          signal,
          stdout,
          stderr,
        })
        log.info('run', pkg._id, event, { code, signal })
      })

      await (this[_doHandleOptionalFailure]
        ? this[_handleOptionalFailure](node, p)
        : p)

      process.emit('timeEnd', timer)
    }), limit)
    process.emit('timeEnd', `build:run:${event}`)
  }

  async [_linkAllBins] () {
    const queue = this[_queues].bin
    if (!queue.length) {
      return
    }

    process.emit('time', 'build:link')
    const promises = []
    // sort the queue by node path, so that the module-local collision
    // detector in bin-links will always resolve the same way.
    for (const node of queue.sort(sortNodes)) {
      promises.push(this[_createBinLinks](node))
    }

    await promiseAllRejectLate(promises)
    process.emit('timeEnd', 'build:link')
  }

  async [_createBinLinks] (node) {
    if (this[_trashList].has(node.path)) {
      return
    }

    process.emit('time', `build:link:${node.location}`)

    const p = binLinks({
      pkg: node.package,
      path: node.path,
      top: !!(node.isTop || node.globalTop),
      force: this[_force],
      global: !!node.globalTop,
    })

    await (this[_doHandleOptionalFailure]
      ? this[_handleOptionalFailure](node, p)
      : p)

    process.emit('timeEnd', `build:link:${node.location}`)
  }
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046641920, function(require, module, exports) {
// Get the actual nodes corresponding to a root node's child workspaces,
// given a list of workspace names.

const log = require('proc-log')
const relpath = require('./relpath.js')

const getWorkspaceNodes = (tree, workspaces) => {
  const wsMap = tree.workspaces
  if (!wsMap) {
    log.warn('workspaces', 'filter set, but no workspaces present')
    return []
  }

  const nodes = []
  for (const name of workspaces) {
    const path = wsMap.get(name)
    if (!path) {
      log.warn('workspaces', `${name} in filter set, but not in workspaces`)
      continue
    }

    const loc = relpath(tree.realpath, path)
    const node = tree.inventory.get(loc)

    if (!node) {
      log.warn('workspaces', `${name} in filter set, but no workspace folder present`)
      continue
    }

    nodes.push(node)
  }

  return nodes
}

module.exports = getWorkspaceNodes

}, function(modId) { var map = {"./relpath.js":1653046641897}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046641879);
})()
//miniprogram-npm-outsideDeps=["path","os","treeverse","./reify.js","events","proc-log","@isaacs/string-locale-compare","npmlog","npm-package-arg","npm-pick-manifest","@npmcli/metavuln-calculator","npm-registry-fetch","semver","read-package-json-fast","pacote","cacache","promise-call-limit","util","readdir-scoped-modules","fs","npm-install-checks","@npmcli/name-from-folder","bin-links","walk-up-path","rimraf","parse-conflict-json","json-stringify-nice","url","@npmcli/map-workspaces","common-ancestor-path","promise-all-reject-late","@npmcli/run-script","@npmcli/node-gyp"]
//# sourceMappingURL=index.js.map