var _ = require("underscore");
var fs = require("fs");
var opensub = new (require("opensubtitles"))();
var get = require("simple-get");

function hash(args, cb)
{
    if (typeof(args.url) !== "string") return cb(new Error("url required"));

    var cb = _.once(cb);
    var res = { };

    var chunk_size = 65536;
    var buf_start = new Buffer(chunk_size*2);
    var buf_end = new Buffer(chunk_size*2);
    var buf_pad = new Buffer(chunk_size);
    var file_size = 0;
    var t_chksum = [];

    var fd;

    var ready = function(chksum_part, name) {
        if (fd) fs.close(fd); fd = null;
        t_chksum.push(chksum_part);

        if(t_chksum.length == 3) {
            var chksum = opensub.sumHex64bits(t_chksum[0], t_chksum[1]);
            chksum = opensub.sumHex64bits(chksum, t_chksum[2]);
            chksum = chksum.substr(-16);
            res.hash = opensub.padLeft(chksum, "0", 16);
            cb(null, res);
        }
    };

    if (args.url.match("^file:")) {
        var p = args.url.slice("file://".length);
        return fs.stat(p, function(err, stat) {
            if(err) return cb(err);

            file_size = res.size = stat.size;
            ready(file_size.toString(16), "filesize");

            fs.open(p, "r", function(err,f) {
                fd = f;
                if(err) return cb(err);
                [{buf:buf_start, offset:0}, {buf:buf_end, offset:file_size-chunk_size}].forEach(function(b) {
                    fs.read(fd, b.buf, 0, chunk_size*2, b.offset, function(err, _, buffer) {
                        if(err) return cb(err);
                        ready(opensub.checksumBuffer(buffer, 16), "buf");
                    });
                });
            });
        });
    }
    
    if (args.url.match(/^http(s?):/)) return get.concat({ url: args.url, method: "HEAD" }, function(err, resp, body) {
        if (err) return cb(err);

        ready((res.size = file_size = parseInt(resp.headers["content-length"], 10)).toString(16), "filesize");

        var ranges = [
            { start: 0, end: chunk_size-1 },
            { start: file_size - chunk_size, end: file_size - 1 }
        ];
        function tryRange(range, next) {
            get.concat({ url: args.url, headers: { range: "bytes="+range.start+"-"+range.end, "enginefs-prio": 10 } }, function(err, resp, data) {
                if (err) return cb(err);
                if (resp.statusCode !== 200 && resp.statusCode !== 206) return cb(new Error("non-200/206 ("+resp.statusCode+") status code returned for range"))
                if (data.length !== chunk_size) return cb(new Error("response for calculating movie hash is wrong length: "+JSON.stringify(range)+" chunk_size "+chunk_size+" but received "+data.length), resp);
                ready(opensub.checksumBuffer(Buffer.concat([data, buf_pad]), 16), "buf");
                if (next) next();
            });
        };

        //ranges.forEach(tryRange); // parallel
        tryRange(ranges[0], function() { tryRange(ranges[1]) }); // series
    });

    return cb(new Error("args.url must begin with http or file"));
};

module.exports = hash;
