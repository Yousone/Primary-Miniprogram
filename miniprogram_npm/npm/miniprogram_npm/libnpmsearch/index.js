module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046642227, function(require, module, exports) {


const npmFetch = require('npm-registry-fetch')

module.exports = search
function search (query, opts) {
  return search.stream(query, opts).collect()
}
search.stream = searchStream
function searchStream (query, opts = {}) {
  opts = {
    detailed: false,
    limit: 20,
    from: 0,
    quality: 0.65,
    popularity: 0.98,
    maintenance: 0.5,
    ...opts.opts, // this is to support the cli's --searchopts parameter
    ...opts,
  }

  switch (opts.sortBy) {
    case 'optimal': {
      opts.quality = 0.65
      opts.popularity = 0.98
      opts.maintenance = 0.5
      break
    }
    case 'quality': {
      opts.quality = 1
      opts.popularity = 0
      opts.maintenance = 0
      break
    }
    case 'popularity': {
      opts.quality = 0
      opts.popularity = 1
      opts.maintenance = 0
      break
    }
    case 'maintenance': {
      opts.quality = 0
      opts.popularity = 0
      opts.maintenance = 1
      break
    }
  }
  return npmFetch.json.stream('/-/v1/search', 'objects.*',
    {
      ...opts,
      query: {
        text: Array.isArray(query) ? query.join(' ') : query,
        size: opts.limit,
        from: opts.from,
        quality: opts.quality,
        popularity: opts.popularity,
        maintenance: opts.maintenance,
      },
      mapJSON: (obj) => {
        if (obj.package.date) {
          obj.package.date = new Date(obj.package.date)
        }
        if (opts.detailed) {
          return obj
        } else {
          return obj.package
        }
      },
    }
  )
}

}, function(modId) {var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046642227);
})()
//miniprogram-npm-outsideDeps=["npm-registry-fetch"]
//# sourceMappingURL=index.js.map