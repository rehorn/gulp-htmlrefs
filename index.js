var path = require('path');
var fs = require('fs');

var through = require('through2');
var gutil = require('gulp-util');

var _ = require('lodash');
var glob = require('glob');

module.exports = function(options) {
    options = options || {};
    options.urlPrefix = options.urlPrefix || '';
    options.scope = options.scope || '.';
    var mapping = options.mapping;
    var revFinder = mapping ? getCandidatesFromMapping : getCandidatesFromFS;
    // console.log(mapping)

    var basePath, mainPath, mainName, alternatePath, extName, pathName;

    var inlineTag = '__inline';
    // var startReg = /<!--\s*build:(\w+)(?:\(([^\)]+?)\))?\s+(\/?([^\s]+?))\s*-->/gim;
    var startReg = /<!--\s*build:htmlrefs\s*-->/gim;
    var endReg = /<!--\s*endbuild\s*-->/gim;
    var startCondReg = /<!--\[[^\]]+\]>/gim;
    var endCondReg = /<!\[endif\]-->/gim;
    var _defaultPatterns = {
        html: [
            [
                /<script.+src=['"]([^"']+)["'].+>/gm,
                'Update the HTML script tag to reference new revved files',
                null,
                scriptHandler
            ],
            [
                /<link[^\>]+href=['"]([^"']+)["']/gm,
                'Update the HTML link css tag to reference new revved files',
                null,
                cssHandler
            ],
            [
                /(?:(?:function\s*)?_urlrev\(\s*)['"]?([^'"\)(\?|#)]+)['"]?\s*\)?/gm,
                'Update the js _urlrev to reference our revved resources',
                null,
                urlRevHandler
            ],
            [
                /<img[^\>]*[^\>\S]+src=['"]([^"']+)["']/gm,
                'Update the HTML with the new img filenames'
            ],
            // [
            //     /<video[^\>]+src=['"]([^"']+)["']/gm,
            //     'Update the HTML with the new video filenames'
            // ],
            // [
            //     /<video[^\>]+poster=['"]([^"']+)["']/gm,
            //     'Update the HTML with the new poster filenames'
            // ],
            // [
            //     /<source[^\>]+src=['"]([^"']+)["']/gm,
            //     'Update the HTML with the new source filenames'
            // ],
            // [
            //     /data-main\s*=['"]([^"']+)['"]/gm,
            //     'Update the HTML with data-main tags',
            //     function(m) {
            //         return m.match(/\.js$/) ? m : m + '.js';
            //     },
            //     function(m) {
            //         return m.replace('.js', '');
            //     }
            // ],
            // [
            //     /data-(?!main).[^=]+=['"]([^'"]+)['"]/gm,
            //     'Update the HTML with data-* tags'
            // ],
            // [
            //     /url\(\s*['"]?([^"'\)]+)["']?\s*\)/gm,
            //     'Update the HTML with background imgs, case there is some inline style'
            // ],
            // [
            //     /<a[^\>]+href=['"]([^"']+)["']/gm,
            //     'Update the HTML with anchors images'
            // ],
            // [
            //     /<input[^\>]+src=['"]([^"']+)["']/gm,
            //     'Update the HTML with reference in input'
            // ],
            // [
            //     /<meta[^\>]+content=['"]([^"']+)["']/gm,
            //     'Update the HTML with the new img filenames in meta tags'
            // ]
        ],
        css: [
            [
                /(?:src=|url\(\s*)['"]?([^'"\)(\?|#)]+)['"]?\s*\)?/gm,
                'Update the CSS to reference our revved images'
            ]
        ],
        js: [
            [
                /(?:(?:function\s*)?_urlrev\(\s*)['"]?([^'"\)(\?|#)]+)['"]?\s*\)?/gm,
                'Update the js _urlrev to reference our revved resources',
                null,
                urlRevHandler
            ]
        ]
    };

    function defaultInHandler(m) {
        return m;
    }

    function defaultOutHandler(revFile, srcFile, tag) {
        if (srcFile.indexOf('://') >= 0) {
            return tag;
        }
        return tag.replace(srcFile, options.urlPrefix + revFile);
    }

    function scriptHandler(revFile, srcFile, tag) {
        if (srcFile.indexOf('://') >= 0) {
            return tag;
        }
        // handler inline
        if (srcFile.indexOf(inlineTag) > 0) {
            var content = readFile(revFile, options.scope);
            return '<script>' + content + '</script>';
        } else {
            return tag.replace(srcFile, options.urlPrefix + revFile);
        }
    }

    function cssHandler(revFile, srcFile, tag) {
        if (srcFile.indexOf('://') >= 0) {
            return tag;
        }
        // handler inline
        if (srcFile.indexOf(inlineTag) > 0) {
            var content = readFile(revFile, options.scope);
            return '<style>' + content + '</style';
        } else {
            return tag.replace(srcFile, options.urlPrefix + revFile);
        }
    }

    function urlRevHandler(revFile, srcFile, tag) {
        if (tag.toLowerCase().indexOf('function') >= 0) {
            return tag;
        }
        return defaultOutHandler(revFile, srcFile, tag);
    }

    function readFile(file, assetSearchPath) {
        var content = '';
        if (!Array.isArray(assetSearchPath)) {
            assetSearchPath = [assetSearchPath];
        }
        for (var i = 0; i < assetSearchPath.length; i++) {
            var fileurl = path.join(assetSearchPath[i], file);
            // console.log(fileurl)
            if (fs.existsSync(fileurl)) {
                content = fs.readFileSync(fileurl);
                break;
            }
        }
        return content;
    };

    function regexpQuote(str) {
        return (str + '').replace(/([.?*+\^$\[\]\\(){}|\-])/g, '\\$1');
    };

    function processPatterns(patterns, fn) {
        var result = [];
        _.flatten(patterns).forEach(function(pattern) {
            var exclusion = pattern.indexOf('!') === 0;
            if (exclusion) {
                pattern = pattern.slice(1);
            }
            // console.log(pattern)
            var matches = fn(pattern);
            if (exclusion) {
                result = _.difference(result, matches);
            } else {
                result = _.union(result, matches);
            }
        });
        // console.log(result)
        return result;
    };

    function createFile(name, content) {
        return new gutil.File({
            path: path.join(path.relative(basePath, mainPath), name),
            contents: new Buffer(content)
        });
    };

    function fileExpand(patterns, options) {
        options = options || {};

        if (!Array.isArray(patterns)) {
            patterns = [patterns];
        }

        if (patterns.length === 0) {
            return [];
        }

        return processPatterns(patterns, function(pattern) {
            return glob.sync(pattern, options);
        });
    };

    // modified from grunt usemin

    function getCandidatesFromMapping(file, searchPaths) {
        var log = gutil.log;
        var dirname = path.dirname(file);
        var candidates = [];
        var self = this;

        searchPaths.forEach(function(sp) {
            var key = path.normalize(path.join(sp, file));
            if (mapping[key]) {
                // We need to transform the actual file to a form that matches the one we received
                // For example if we received file 'foo/images/test.png' with searchPaths == ['dist'],
                // and found in mapping that 'dist/foo/images/test.png' has been renamed
                // 'dist/foo/images/test.1234.png' by grunt-rev, then we need to return
                // 'foo/images/test.1234.png'
                var cfile = path.basename(mapping[key]);
                candidates.push(dirname + '/' + cfile);
            }
        });

        return candidates;
    };

    function getCandidatesFromFS(file, searchPaths) {
        var extname = path.extname(file);
        var basename = path.basename(file, extname);
        var dirname = path.dirname(file);
        var hex = '[0-9a-fA-F]+';
        var regPrefix = '(' + hex + '-' + regexpQuote(basename) + ')';
        var regSuffix = '(' + regexpQuote(basename) + '-' + hex + regexpQuote(extname) + ')';
        var revvedRx = new RegExp(regPrefix + '|' + regSuffix);
        var candidates = [];
        var self = this;

        searchPaths.forEach(function(sp) {
            var searchString = path.join(sp, dirname, basename + '-*' + extname);
            var prefixSearchString = path.join(sp, dirname, '*-' + basename + extname);

            if (searchString.indexOf('#') === 0) {
                // patterns starting with # are treated as comments by the glob implementation which returns undefined,
                // which would cause an unhandled exception in self.expandfn below so the file is never written
                return;
            }
            var files = fileExpand([searchString, prefixSearchString]);

            // Keep only files that look like a revved file
            var goodFiles = files.filter(function(f) {
                return f.match(revvedRx);
            });

            // We must now remove the search path from the beginning, and add them to the
            // list of candidates
            goodFiles.forEach(function(gf) {
                var goodFileName = path.basename(gf);
                if (!file.match(/\//)) {
                    candidates.push(goodFileName);
                } else {
                    candidates.push(dirname + '/' + goodFileName);
                }
            });
        });

        return candidates;
    };

    function replaceWithRevved(type, lines, assetSearchPath) {
        var regexps = _defaultPatterns;
        var content = lines;
        // var log = gutil.log;
        var log = function() {};

        regexps[type].forEach(function(rxl) {
            var filterIn = rxl[2] || defaultInHandler;
            var filterOut = rxl[3] || defaultOutHandler;

            content = content.replace(rxl[0], function(match, src) {
                // Consider reference from site root
                var srcFile = filterIn(src);
                log('looking for revved version of ' + src + ' in ', assetSearchPath);

                var file = revFinder(srcFile.split('?')[0], assetSearchPath);
                var res = match;
                file = file.join('');
                if (!file) {
                    log('no revved version of ' + src + ' found!');
                    file = src;
                } else {
                    log('replace "' + src + '" to "' + file + '"');
                }
                res = filterOut(file, src, match);
                return res;
            });
        });

        return content;
    };

    function processHTML(content) {

        // // only replace <!-- build:htmlrefs --> block to improve speed
        // var html = [];
        // var sections = content.split(endReg);
        // for (var i = 0, l = sections.length; i < l; ++i) {
        //     if (sections[i].match(startReg)) {
        //         var section = sections[i].split(startReg);

        //         // content before <!-- build:
        //         html.push(section[0]);

        //         html.push(replaceWithRevved('html', section[1], options.scope));

        //     } else {
        //         html.push(sections[i]);
        //     }
        // }

        // return html.join('');

        // global replacement 
        return replaceWithRevved('html', content, options.scope);
    }

    function proccessCSS(content) {
        return replaceWithRevved('css', content, options.scope);
    }

    function processJS(content) {
        return replaceWithRevved('js', content, options.scope);
    }

    function process(content, push, callback) {
        gutil.log('htmlrefs: process file ' + mainName);
        var handler = processHTML;
        if (extName == '.html') {
            handler = processHTML;
        } else if (extName == '.css') {
            handler = proccessCSS;
        } else if (extName == '.js') {
            handler = processJS;
        }

        var result = handler(content);

        var file = createFile(mainName, result);
        push(file);
        callback();
    };

    return through.obj(function(file, enc, callback) {
        if (file.isNull()) {
            this.push(file); // Do nothing if no contents
            callback();
        } else if (file.isStream()) {
            this.emit('error', new gutil.PluginError('gulp-htmlrefs', 'Streams are not supported!'));
            callback();
        } else {
            basePath = file.base;
            mainPath = path.dirname(file.path);
            mainName = path.basename(file.path);
            extName = path.extname(file.path);
            pathName = file.path;

            process(String(file.contents), this.push.bind(this), callback);
        }
    });
};
