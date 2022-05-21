module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046642292, function(require, module, exports) {


const reporters = {
  install: require('./reporters/install'),
  detail: require('./reporters/detail'),
  json: require('./reporters/json'),
  quiet: require('./reporters/quiet')
}

const exitCode = require('./exit-code.js')

module.exports = Object.assign((data, options = {}) => {
  const {
    reporter = 'install',
    color = true,
    unicode = true,
    indent = 2,
  } = options

  // CLI defaults this to `null` so the defaulting method above doesn't work
  const auditLevel = options.auditLevel || 'low'

  if (!data)
    throw Object.assign(
      new TypeError('ENOAUDITDATA'),
      {
        code: 'ENOAUDITDATA',
        message: 'missing audit data'
      }
    )

  if (typeof data.toJSON === 'function')
    data = data.toJSON()

  return {
    report: reporters[reporter](data, { color, unicode, indent }),
    exitCode: exitCode(data, auditLevel)
  }
}, { reporters })

}, function(modId) {var map = {"./reporters/install":1653046642293,"./reporters/detail":1653046642295,"./reporters/json":1653046642296,"./reporters/quiet":1653046642297,"./exit-code.js":1653046642298}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642293, function(require, module, exports) {
const colors = require('../colors.js')

const calculate = (data, { color }) => {
  const c = colors(color)
  const output = []
  const { metadata: { vulnerabilities }} = data
  const vulnCount = vulnerabilities.total

  let someFixable = false
  let someForceFixable = false
  let forceFixSemVerMajor = false
  let someUnfixable = false

  if (vulnCount === 0) {
    output.push(`found ${c.green('0')} vulnerabilities`)
  } else {
    for (const [name, vuln] of Object.entries(data.vulnerabilities)) {
      const { fixAvailable } = vuln
      someFixable = someFixable || fixAvailable === true
      someUnfixable = someUnfixable || fixAvailable === false
      if (typeof fixAvailable === 'object') {
        someForceFixable = true
        forceFixSemVerMajor = forceFixSemVerMajor || fixAvailable.isSemVerMajor
      }
    }
    const total = vulnerabilities.total
    const sevs = Object.entries(vulnerabilities).filter(([s, count]) => {
      return (s === 'low' || s === 'moderate' || s === 'high' || s === 'critical') &&
        count > 0
    })

    if (sevs.length > 1) {
      const severities = sevs.map(([s, count]) => {
        return `${count} ${c.severity(s)}`
      }).join(', ')
      output.push(`${c.red(total)} vulnerabilities (${severities})`)
    } else {
      const [sev, count] = sevs[0]
      output.push(`${count} ${c.severity(sev)} severity vulnerabilit${count === 1 ? 'y' : 'ies'}`)
    }

    // XXX use a different footer line if some aren't fixable easily.
    // just 'run `npm audit` for details' maybe?

    if (someFixable) {
      output.push('', 'To address ' +
        (someForceFixable || someUnfixable ? 'issues that do not require attention'
          : 'all issues') + ', run:\n  npm audit fix')
    }

    if (someForceFixable) {
      output.push('', 'To address all issues' +
        (someUnfixable ? ' possible' : '') +
        (forceFixSemVerMajor ? ' (including breaking changes)' : '') +
        ', run:\n  npm audit fix --force')
    }

    if (someUnfixable) {
      output.push('',
        'Some issues need review, and may require choosing',
        'a different dependency.')
    }
  }

  const summary = output.join('\n')
  return {
    summary,
    report: vulnCount > 0 ? `${summary}\n\nRun \`npm audit\` for details.`
      : summary
  }
}

module.exports = Object.assign((data, opt) => calculate(data, opt).report, {
  summary: (data, opt) => calculate(data, opt).summary
})

}, function(modId) { var map = {"../colors.js":1653046642294}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642294, function(require, module, exports) {
const chalk = require('chalk')
module.exports = color => {
  const identity = x => x
  const green = color ? s => chalk.green.bold(s) : identity
  const red = color ? s => chalk.red.bold(s) : identity
  const magenta = color ? s => chalk.magenta.bold(s) : identity
  const yellow = color ? s => chalk.yellow.bold(s) : identity
  const white = color ? s => chalk.bold(s) : identity
  const severity = (sev, s) => sev.toLowerCase() === 'moderate' ? yellow(s || sev)
    : sev.toLowerCase() === 'high' ? red(s || sev)
    : sev.toLowerCase() === 'critical' ? magenta(s || sev)
    : white(s || sev)
  const dim = color ? s => chalk.dim(s) : identity

  return {
    dim,
    green,
    red,
    magenta,
    yellow,
    white,
    severity
  }
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642295, function(require, module, exports) {


const colors = require('../colors.js')
const install = require('./install.js')

module.exports = (data, { color }) => {
  const summary = install.summary(data, { color })
  const none = data.metadata.vulnerabilities.total === 0
  return none ? summary : fullReport(data, {color, summary})
}

const fullReport = (data, { color, summary }) => {
  const c = colors(color)
  const output = [c.white('# npm audit report'), '']

  const printed = new Set()
  for (const [name, vuln] of Object.entries(data.vulnerabilities)) {
    // only print starting from the top-level advisories
    if (vuln.via.filter(v => typeof v !== 'string').length !== 0)
      output.push(printVuln(vuln, c, data.vulnerabilities))
  }

  output.push(summary)

  return output.join('\n')
}

const printVuln = (vuln, c, vulnerabilities, printed = new Set(), indent = '') => {
  if (printed.has(vuln))
    return null

  printed.add(vuln)
  const output = []

  output.push(c.white(vuln.name) + '  ' + vuln.range)

  if (indent === '' && (vuln.severity !== 'low' || vuln.severity === 'info')) {
    output.push(`Severity: ${c.severity(vuln.severity)}`)
  }

  for (const via of vuln.via) {
    if (typeof via === 'string') {
      output.push(`Depends on vulnerable versions of ${c.white(via)}`)
    } else if (indent === '') {
      output.push(`${c.white(via.title)} - ${via.url}`)
    }
  }

  if (indent === '') {
    const { fixAvailable: fa } = vuln
    if (fa === false) {
      output.push(c.red('No fix available'))
    } else if (fa === true) {
      output.push(c.green('fix available') + ' via `npm audit fix`')
    } else {
      /* istanbul ignore else - should be impossible, just being cautious */
      if (typeof fa === 'object' && indent === '') {
        output.push(
          `${c.yellow('fix available')} via \`npm audit fix --force\``,
          `Will install ${fa.name}@${fa.version}` +
          `, which is ${fa.isSemVerMajor ? 'a breaking change' :
            'outside the stated dependency range' }`
        )
      }
    }
  }

  for (const path of vuln.nodes) {
    output.push(c.dim(path))
  }

  for (const effect of vuln.effects) {
    const vuln = vulnerabilities[effect]
    const e = printVuln(vuln, c, vulnerabilities, printed, '  ')
    if (e)
      output.push(...e.split('\n'))
  }

  if (indent === '') {
    output.push('')
  }

  return output.map(l => `${indent}${l}`).join('\n')
}

}, function(modId) { var map = {"../colors.js":1653046642294,"./install.js":1653046642293}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642296, function(require, module, exports) {
module.exports = (data, { indent }) => JSON.stringify(data, null, indent)

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642297, function(require, module, exports) {
module.exports = () => ''

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642298, function(require, module, exports) {
// return 1 if any vulns in the set are at or above the specified severity
const severities = new Map(Object.entries([
  'info',
  'low',
  'moderate',
  'high',
  'critical',
  'none'
]).map(s => s.reverse()))

module.exports = (data, level) =>
  Object.entries(data.metadata.vulnerabilities)
    .some(([sev, count]) => count > 0 && severities.has(sev) &&
      severities.get(sev) >= severities.get(level)) ? 1 : 0

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046642292);
})()
//miniprogram-npm-outsideDeps=["chalk"]
//# sourceMappingURL=index.js.map