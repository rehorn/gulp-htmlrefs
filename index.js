var path = require('path');
var fs = require('fs');
var EOL = require('os').EOL;

var through = require('through2');
var gutil = require('gulp-util');
var glob = require('glob');


module.exports = function(options) {
    options = options || {};


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

            processHtml(String(file.contents), this.push.bind(this), callback);
        }
    });
};
