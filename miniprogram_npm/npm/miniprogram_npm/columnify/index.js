module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1653046642079, function(require, module, exports) {


var wcwidth = require('./width');

var _require = require('./utils'),
    padRight = _require.padRight,
    padCenter = _require.padCenter,
    padLeft = _require.padLeft,
    splitIntoLines = _require.splitIntoLines,
    splitLongWords = _require.splitLongWords,
    truncateString = _require.truncateString;

var DEFAULT_HEADING_TRANSFORM = function DEFAULT_HEADING_TRANSFORM(key) {
  return key.toUpperCase();
};

var DEFAULT_DATA_TRANSFORM = function DEFAULT_DATA_TRANSFORM(cell, column, index) {
  return cell;
};

var DEFAULTS = Object.freeze({
  maxWidth: Infinity,
  minWidth: 0,
  columnSplitter: ' ',
  truncate: false,
  truncateMarker: '…',
  preserveNewLines: false,
  paddingChr: ' ',
  showHeaders: true,
  headingTransform: DEFAULT_HEADING_TRANSFORM,
  dataTransform: DEFAULT_DATA_TRANSFORM
});

module.exports = function (items) {
  var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};


  var columnConfigs = options.config || {};
  delete options.config; // remove config so doesn't appear on every column.

  var maxLineWidth = options.maxLineWidth || Infinity;
  if (maxLineWidth === 'auto') maxLineWidth = process.stdout.columns || Infinity;
  delete options.maxLineWidth; // this is a line control option, don't pass it to column

  // Option defaults inheritance:
  // options.config[columnName] => options => DEFAULTS
  options = mixin({}, DEFAULTS, options);

  options.config = options.config || Object.create(null);

  options.spacing = options.spacing || '\n'; // probably useless
  options.preserveNewLines = !!options.preserveNewLines;
  options.showHeaders = !!options.showHeaders;
  options.columns = options.columns || options.include; // alias include/columns, prefer columns if supplied
  var columnNames = options.columns || []; // optional user-supplied columns to include

  items = toArray(items, columnNames);

  // if not suppled column names, automatically determine columns from data keys
  if (!columnNames.length) {
    items.forEach(function (item) {
      for (var columnName in item) {
        if (columnNames.indexOf(columnName) === -1) columnNames.push(columnName);
      }
    });
  }

  // initialize column defaults (each column inherits from options.config)
  var columns = columnNames.reduce(function (columns, columnName) {
    var column = Object.create(options);
    columns[columnName] = mixin(column, columnConfigs[columnName]);
    return columns;
  }, Object.create(null));

  // sanitize column settings
  columnNames.forEach(function (columnName) {
    var column = columns[columnName];
    column.name = columnName;
    column.maxWidth = Math.ceil(column.maxWidth);
    column.minWidth = Math.ceil(column.minWidth);
    column.truncate = !!column.truncate;
    column.align = column.align || 'left';
  });

  // sanitize data
  items = items.map(function (item) {
    var result = Object.create(null);
    columnNames.forEach(function (columnName) {
      // null/undefined -> ''
      result[columnName] = item[columnName] != null ? item[columnName] : '';
      // toString everything
      result[columnName] = '' + result[columnName];
      if (columns[columnName].preserveNewLines) {
        // merge non-newline whitespace chars
        result[columnName] = result[columnName].replace(/[^\S\n]/gmi, ' ');
      } else {
        // merge all whitespace chars
        result[columnName] = result[columnName].replace(/\s/gmi, ' ');
      }
    });
    return result;
  });

  // transform data cells
  columnNames.forEach(function (columnName) {
    var column = columns[columnName];
    items = items.map(function (item, index) {
      var col = Object.create(column);
      item[columnName] = column.dataTransform(item[columnName], col, index);

      var changedKeys = Object.keys(col);
      // disable default heading transform if we wrote to column.name
      if (changedKeys.indexOf('name') !== -1) {
        if (column.headingTransform !== DEFAULT_HEADING_TRANSFORM) return;
        column.headingTransform = function (heading) {
          return heading;
        };
      }
      changedKeys.forEach(function (key) {
        return column[key] = col[key];
      });
      return item;
    });
  });

  // add headers
  var headers = {};
  if (options.showHeaders) {
    columnNames.forEach(function (columnName) {
      var column = columns[columnName];

      if (!column.showHeaders) {
        headers[columnName] = '';
        return;
      }

      headers[columnName] = column.headingTransform(column.name);
    });
    items.unshift(headers);
  }
  // get actual max-width between min & max
  // based on length of data in columns
  columnNames.forEach(function (columnName) {
    var column = columns[columnName];
    column.width = items.map(function (item) {
      return item[columnName];
    }).reduce(function (min, cur) {
      // if already at maxWidth don't bother testing
      if (min >= column.maxWidth) return min;
      return Math.max(min, Math.min(column.maxWidth, Math.max(column.minWidth, wcwidth(cur))));
    }, 0);
  });

  // split long words so they can break onto multiple lines
  columnNames.forEach(function (columnName) {
    var column = columns[columnName];
    items = items.map(function (item) {
      item[columnName] = splitLongWords(item[columnName], column.width, column.truncateMarker);
      return item;
    });
  });

  // wrap long lines. each item is now an array of lines.
  columnNames.forEach(function (columnName) {
    var column = columns[columnName];
    items = items.map(function (item, index) {
      var cell = item[columnName];
      item[columnName] = splitIntoLines(cell, column.width);

      // if truncating required, only include first line + add truncation char
      if (column.truncate && item[columnName].length > 1) {
        item[columnName] = splitIntoLines(cell, column.width - wcwidth(column.truncateMarker));
        var firstLine = item[columnName][0];
        if (!endsWith(firstLine, column.truncateMarker)) item[columnName][0] += column.truncateMarker;
        item[columnName] = item[columnName].slice(0, 1);
      }
      return item;
    });
  });

  // recalculate column widths from truncated output/lines
  columnNames.forEach(function (columnName) {
    var column = columns[columnName];
    column.width = items.map(function (item) {
      return item[columnName].reduce(function (min, cur) {
        if (min >= column.maxWidth) return min;
        return Math.max(min, Math.min(column.maxWidth, Math.max(column.minWidth, wcwidth(cur))));
      }, 0);
    }).reduce(function (min, cur) {
      if (min >= column.maxWidth) return min;
      return Math.max(min, Math.min(column.maxWidth, Math.max(column.minWidth, cur)));
    }, 0);
  });

  var rows = createRows(items, columns, columnNames, options.paddingChr); // merge lines into rows
  // conceive output
  return rows.reduce(function (output, row) {
    return output.concat(row.reduce(function (rowOut, line) {
      return rowOut.concat(line.join(options.columnSplitter));
    }, []));
  }, []).map(function (line) {
    return truncateString(line, maxLineWidth);
  }).join(options.spacing);
};

/**
 * Convert wrapped lines into rows with padded values.
 *
 * @param Array items data to process
 * @param Array columns column width settings for wrapping
 * @param Array columnNames column ordering
 * @return Array items wrapped in arrays, corresponding to lines
 */

function createRows(items, columns, columnNames, paddingChr) {
  return items.map(function (item) {
    var row = [];
    var numLines = 0;
    columnNames.forEach(function (columnName) {
      numLines = Math.max(numLines, item[columnName].length);
    });
    // combine matching lines of each rows

    var _loop = function _loop(i) {
      row[i] = row[i] || [];
      columnNames.forEach(function (columnName) {
        var column = columns[columnName];
        var val = item[columnName][i] || ''; // || '' ensures empty columns get padded
        if (column.align === 'right') row[i].push(padLeft(val, column.width, paddingChr));else if (column.align === 'center' || column.align === 'centre') row[i].push(padCenter(val, column.width, paddingChr));else row[i].push(padRight(val, column.width, paddingChr));
      });
    };

    for (var i = 0; i < numLines; i++) {
      _loop(i);
    }
    return row;
  });
}

/**
 * Object.assign
 *
 * @return Object Object with properties mixed in.
 */

function mixin() {
  if (Object.assign) return Object.assign.apply(Object, arguments);
  return ObjectAssign.apply(undefined, arguments);
}

function ObjectAssign(target, firstSource) {
  

  if (target === undefined || target === null) throw new TypeError("Cannot convert first argument to object");

  var to = Object(target);

  var hasPendingException = false;
  var pendingException;

  for (var i = 1; i < arguments.length; i++) {
    var nextSource = arguments[i];
    if (nextSource === undefined || nextSource === null) continue;

    var keysArray = Object.keys(Object(nextSource));
    for (var nextIndex = 0, len = keysArray.length; nextIndex < len; nextIndex++) {
      var nextKey = keysArray[nextIndex];
      try {
        var desc = Object.getOwnPropertyDescriptor(nextSource, nextKey);
        if (desc !== undefined && desc.enumerable) to[nextKey] = nextSource[nextKey];
      } catch (e) {
        if (!hasPendingException) {
          hasPendingException = true;
          pendingException = e;
        }
      }
    }

    if (hasPendingException) throw pendingException;
  }
  return to;
}

/**
 * Adapted from String.prototype.endsWith polyfill.
 */

function endsWith(target, searchString, position) {
  position = position || target.length;
  position = position - searchString.length;
  var lastIndex = target.lastIndexOf(searchString);
  return lastIndex !== -1 && lastIndex === position;
}

function toArray(items, columnNames) {
  if (Array.isArray(items)) return items;
  var rows = [];
  for (var key in items) {
    var item = {};
    item[columnNames[0] || 'key'] = key;
    item[columnNames[1] || 'value'] = items[key];
    rows.push(item);
  }
  return rows;
}


}, function(modId) {var map = {"./width":1653046642080,"./utils":1653046642081}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642080, function(require, module, exports) {
var stripAnsi = require('strip-ansi')
var wcwidth = require('wcwidth')

module.exports = function(str) {
  return wcwidth(stripAnsi(str))
}

}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1653046642081, function(require, module, exports) {


var wcwidth = require('./width')

/**
 * repeat string `str` up to total length of `len`
 *
 * @param String str string to repeat
 * @param Number len total length of output string
 */

function repeatString(str, len) {
  return Array.apply(null, {length: len + 1}).join(str).slice(0, len)
}

/**
 * Pad `str` up to total length `max` with `chr`.
 * If `str` is longer than `max`, padRight will return `str` unaltered.
 *
 * @param String str string to pad
 * @param Number max total length of output string
 * @param String chr optional. Character to pad with. default: ' '
 * @return String padded str
 */

function padRight(str, max, chr) {
  str = str != null ? str : ''
  str = String(str)
  var length = max - wcwidth(str)
  if (length <= 0) return str
  return str + repeatString(chr || ' ', length)
}

/**
 * Pad `str` up to total length `max` with `chr`.
 * If `str` is longer than `max`, padCenter will return `str` unaltered.
 *
 * @param String str string to pad
 * @param Number max total length of output string
 * @param String chr optional. Character to pad with. default: ' '
 * @return String padded str
 */

function padCenter(str, max, chr) {
  str = str != null ? str : ''
  str = String(str)
  var length = max - wcwidth(str)
  if (length <= 0) return str
  var lengthLeft = Math.floor(length/2)
  var lengthRight = length - lengthLeft
  return repeatString(chr || ' ', lengthLeft) + str + repeatString(chr || ' ', lengthRight)
}

/**
 * Pad `str` up to total length `max` with `chr`, on the left.
 * If `str` is longer than `max`, padRight will return `str` unaltered.
 *
 * @param String str string to pad
 * @param Number max total length of output string
 * @param String chr optional. Character to pad with. default: ' '
 * @return String padded str
 */

function padLeft(str, max, chr) {
  str = str != null ? str : ''
  str = String(str)
  var length = max - wcwidth(str)
  if (length <= 0) return str
  return repeatString(chr || ' ', length) + str
}

/**
 * Split a String `str` into lines of maxiumum length `max`.
 * Splits on word boundaries. Preserves existing new lines.
 *
 * @param String str string to split
 * @param Number max length of each line
 * @return Array Array containing lines.
 */

function splitIntoLines(str, max) {
  function _splitIntoLines(str, max) {
    return str.trim().split(' ').reduce(function(lines, word) {
      var line = lines[lines.length - 1]
      if (line && wcwidth(line.join(' ')) + wcwidth(word) < max) {
        lines[lines.length - 1].push(word) // add to line
      }
      else lines.push([word]) // new line
      return lines
    }, []).map(function(l) {
      return l.join(' ')
    })
  }
  return str.split('\n').map(function(str) {
    return _splitIntoLines(str, max)
  }).reduce(function(lines, line) {
    return lines.concat(line)
  }, [])
}

/**
 * Add spaces and `truncationChar` between words of
 * `str` which are longer than `max`.
 *
 * @param String str string to split
 * @param Number max length of each line
 * @param Number truncationChar character to append to split words
 * @return String
 */

function splitLongWords(str, max, truncationChar) {
  str = str.trim()
  var result = []
  var words = str.split(' ')
  var remainder = ''

  var truncationWidth = wcwidth(truncationChar)

  while (remainder || words.length) {
    if (remainder) {
      var word = remainder
      remainder = ''
    } else {
      var word = words.shift()
    }

    if (wcwidth(word) > max) {
      // slice is based on length no wcwidth
      var i = 0
      var wwidth = 0
      var limit = max - truncationWidth
      while (i < word.length) {
        var w = wcwidth(word.charAt(i))
        if (w + wwidth > limit) {
          break
        }
        wwidth += w
        ++i
      }

      remainder = word.slice(i) // get remainder
      // save remainder for next loop

      word = word.slice(0, i) // grab truncated word
      word += truncationChar // add trailing … or whatever
    }
    result.push(word)
  }

  return result.join(' ')
}


/**
 * Truncate `str` into total width `max`
 * If `str` is shorter than `max`,  will return `str` unaltered.
 *
 * @param String str string to truncated
 * @param Number max total wcwidth of output string
 * @return String truncated str
 */

function truncateString(str, max) {

  str = str != null ? str : ''
  str = String(str)

  if(max == Infinity) return str

  var i = 0
  var wwidth = 0
  while (i < str.length) {
    var w = wcwidth(str.charAt(i))
    if(w + wwidth > max)
      break
    wwidth += w
    ++i
  }
  return str.slice(0, i)
}



/**
 * Exports
 */

module.exports.padRight = padRight
module.exports.padCenter = padCenter
module.exports.padLeft = padLeft
module.exports.splitIntoLines = splitIntoLines
module.exports.splitLongWords = splitLongWords
module.exports.truncateString = truncateString

}, function(modId) { var map = {"./width":1653046642080}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1653046642079);
})()
//miniprogram-npm-outsideDeps=["strip-ansi","wcwidth"]
//# sourceMappingURL=index.js.map