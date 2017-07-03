import test from 'ava';
import bl from 'bl';
import { File, Directory, Symlink } from '../lib/INodes';
import { VirtualFS } from '../lib/VirtualFS';

test('has an empty root directory at startup - sync', t => {
  const fs = new VirtualFS;
  t.deepEqual(fs.readdirSync('/'), []);
  const stat = fs.statSync('/');
  t.is(stat.isFile(), false);
  t.is(stat.isDirectory(), true);
  t.is(stat.isSymbolicLink(), false);
});

test.cb('has an empty root directory at startup - callback', t => {
  const fs = new VirtualFS;
  fs.readdir('/', (err, list) => {
    t.deepEqual(list, []);
    fs.stat('/', (err, stat) => {
      t.is(stat.isFile(), false);
      t.is(stat.isDirectory(), true);
      t.is(stat.isSymbolicLink(), false);
      t.end();
    });
  });
});

test('is able to make directories - sync', t => {
  const fs = new VirtualFS;
  fs.mkdirSync('/first');
  fs.mkdirSync('/first//sub/');
  fs.mkdirpSync('/first/sub2');
  fs.mkdirSync('/backslash\\dir');
  fs.mkdirpSync('/');
  t.deepEqual(fs.readdirSync('/'), ['first', 'backslash\\dir']);
  t.deepEqual(fs.readdirSync('/first/'), ['sub', 'sub2']);
  fs.mkdirpSync('/a/depth/sub/dir');
  t.is(fs.existsSync('/a/depth/sub'), true);
  const stat = fs.statSync('/a/depth/sub');
  t.is(stat.isFile(), false);
  t.is(stat.isDirectory(), true);
});

test.cb('is able to make directories - callback', t => {
  const fs = new VirtualFS;
  fs.mkdir('/first', (err) => {
    fs.mkdir('/first//sub/', (err) => {
      fs.mkdir('/first/sub2/', (err) => {
        fs.mkdir('/backslash\\dir', (err) => {
          fs.mkdirp('/', (err) => {
            fs.readdir('/', (err, list) => {
              t.deepEqual(list, ['first', 'backslash\\dir']);
              fs.readdir('/first/', (err, list) => {
                t.deepEqual(list, ['sub', 'sub2']);
                fs.mkdirp('/a/depth/sub/dir', (err) => {
                  fs.exists('/a/depth/sub', (exists) => {
                    t.is(exists, true);
                    fs.stat('/a/depth/sub', (err, stat) => {
                      t.is(stat.isFile(), false);
                      t.is(stat.isDirectory(), true);
                      t.end();
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});

test('should not make the root directory - sync', t => {
  const fs = new VirtualFS;
  const error = t.throws(() => {
    fs.mkdirSync('/');
  });
  t.is(error.code, 'EEXIST');
});

test('should be able to remove directories - sync', (t) => {
  const fs = new VirtualFS;
  fs.mkdirSync("/first");
  fs.mkdirSync("/first//sub/");
  fs.mkdirpSync("/first/sub2");
  fs.mkdirSync("/backslash\\dir");
  fs.rmdirSync("/first/sub//");
  const firstlist = fs.readdirSync("//first");
  t.deepEqual(firstlist, ['sub2']);
  fs.rmdirSync("/first/sub2");
  fs.rmdirSync('/first');
  const exists = fs.existsSync('/first');
  t.is(exists, false);
  const errorAccess = t.throws(() => {
    fs.accessSync('/first');
  });
  t.is(errorAccess.code, 'ENOENT');
  const errorReadDir = t.throws(() => {
    fs.readdirSync('/first');
  });
  t.is(errorReadDir.code, 'ENOENT');
  const rootlist = fs.readdirSync('/');
  t.deepEqual(rootlist, ['backslash\\dir']);
});

test.cb('calls with mode are ignored, mode is always 777 - callback', (t) => {
  const fs = new VirtualFS;
  fs.mkdir('/test', 0o644, (err) => {
    fs.accessSync(
      '/test',
      (fs.constants.F_OK |
       fs.constants.R_OK |
       fs.constants.W_OK |
       fs.constants.X_OK)
    );
    fs.chmod('/test', 0o444, (err) => {
      fs.accessSync(
        '/test',
        (fs.constants.F_OK |
         fs.constants.R_OK |
         fs.constants.W_OK |
         fs.constants.X_OK)
      );
      t.end();
    });
  });
});

test('chown does nothing - sync', (t) => {
  const fs = new VirtualFS;
  fs.mkdirSync('/test');
  fs.chownSync('/test', 1000, 1000);
  const stat = fs.statSync('/test');
  t.is(stat.uid, 0);
  t.is(stat.gid, 0);
});

test('can make and remove files', (t) => {
  const fs = new VirtualFS;
  fs.mkdirSync('/test');
  const buf = new Buffer('Hello World', 'utf-8');
  fs.writeFileSync('/test/hello-world.txt', buf);
  t.deepEqual(fs.readFileSync('/test/hello-world.txt'), buf);
  t.is(fs.readFileSync('/test/hello-world.txt', 'utf-8'), 'Hello World');
  t.is(fs.readFileSync('/test/hello-world.txt', { encoding: 'utf-8' }), 'Hello World');
  fs.writeFileSync('/a', 'Test', 'utf-8');
  t.is(fs.readFileSync('/a', 'utf-8'), 'Test');
  const stat = fs.statSync('/a');
  t.is(stat.isFile(), true);
  t.is(stat.isDirectory(), false);
  fs.writeFileSync('/b', 'Test', { encoding: 'utf-8' });
  t.is(fs.readFileSync('/b', 'utf-8'), 'Test');
  t.throws(() => {
    fs.readFileSync('/test/other-file');
  });
  t.throws(() => {
    fs.readFileSync('/test/other-file', 'utf-8');
  });
});

// describe("files", function() {

// describe('hardlinks', function () {

//   it('should create multiple hardlinks to the same file', function () {
// 		var fs = new VirtualFS();
// 		fs.mkdirSync("/test");
//     fs.writeFileSync('/test/a');
//     fs.linkSync('/test/a', '/test/b');
//     let indexA = fs.statSync('/test/a').ino;
//     let indexB = fs.statSync('/test/b').ino;
//     indexA.should.be.eql(indexB);
//     fs.readFileSync('/test/a').should.be.eql(fs.readFileSync('/test/b'));
//   });

//   it('should not create hardlinks to directories', function () {
// 		var fs = new VirtualFS();
// 		fs.mkdirSync("/test");
// 	  (function () {
//       fs.linkSync('/test', '/hardlinktotest');
// 	  }).should.throw(/EPERM/);
//   });

// });

// describe("symlinks", function() {

// 	it("should add and traverse symlinks", function() {
// 		var fs = new VirtualFS();
// 		fs.mkdirSync("/test");
// 		var buf = new Buffer("Hello World", "utf-8");
// 		fs.writeFileSync("/test/hello-world.txt", buf);
//     fs.symlinkSync('/test', '/linktotestdir');
//     fs.readlinkSync('/linktotestdir'). should.be.eql('/test');
// 		fs.readdirSync("/linktotestdir").should.be.eql(['hello-world.txt']);
//     fs.symlinkSync('/linktotestdir/hello-world.txt', '/linktofile');
//     fs.readFileSync('/linktofile', 'utf-8').should.be.eql('Hello World');
// 	});

// 	it("should traverse relative symlinks", function() {
// 		var fs = new VirtualFS();
// 		fs.mkdirSync("/test");
// 		var buf = new Buffer("Hello World", "utf-8");
//     fs.writeFileSync('/a', buf);
//     fs.symlinkSync('../a', '/test/linktoa');
//     fs.readFileSync('/test/linktoa', 'utf-8').should.be.eql('Hello World');
// 	});

//   it ("it should delete only the symlink", function () {
// 		var fs = new VirtualFS();
// 		fs.mkdirSync("/test");
// 		var buf = new Buffer("Hello World", "utf-8");
// 		fs.writeFileSync("/test/hello-world.txt", buf);
//     fs.symlinkSync('/test', '/linktotestdir');
//     fs.symlinkSync('/linktotestdir/hello-world.txt', '/linktofile');
//     fs.unlinkSync('/linktotestdir');
//     fs.unlinkSync('/linktofile');
//     fs.readdirSync('/test').should.be.eql(['hello-world.txt']);
//   });

// });

// describe("errors", function() {
// 	it("should fail on invalid paths", function() {
// 		var fs = new VirtualFS();
// 		fs.mkdirpSync("/test/a/b/c");
// 		fs.mkdirpSync("/test/a/bc");
// 		fs.mkdirpSync("/test/abc");
// 		(function() {
// 			fs.readdirSync("/test/abc/a/b/c");
// 		}).should.throw();
// 		(function() {
// 			fs.readdirSync("/abc");
// 		}).should.throw();
// 		(function() {
// 			fs.statSync("/abc");
// 		}).should.throw();
// 		(function() {
// 			fs.mkdirSync("/test/a/d/b/c");
// 		}).should.throw();
// 		(function() {
// 			fs.writeFileSync("/test/a/d/b/c", "Hello");
// 		}).should.throw();
// 		(function() {
// 			fs.readFileSync("/test/a/d/b/c");
// 		}).should.throw();
// 		(function() {
// 			fs.readFileSync("/test/abcd");
// 		}).should.throw();
// 		(function() {
// 			fs.mkdirSync("/test/abcd/dir");
// 		}).should.throw();
// 		(function() {
// 			fs.unlinkSync("/test/abcd");
// 		}).should.throw();
// 		(function() {
// 			fs.unlinkSync("/test/abcd/file");
// 		}).should.throw();
// 		(function() {
// 			fs.statSync("/test/a/d/b/c");
// 		}).should.throw();
// 		(function() {
// 			fs.statSync("/test/abcd");
// 		}).should.throw();
// 		fs.mkdir("/test/a/d/b/c", function(err) {
// 			err.should.be.instanceof(Error);
// 		});
// 	});
// 	it("should fail on wrong type", function() {
// 		var fs = new VirtualFS();
// 		fs.mkdirpSync("/test/dir");
// 		fs.mkdirpSync("/test/dir");
// 		fs.writeFileSync("/test/file", "Hello");
// 		(function() {
// 			fs.writeFileSync("/test/dir", "Hello");
// 		}).should.throw();
// 		(function() {
// 			fs.readFileSync("/test/dir");
// 		}).should.throw();
// 		(function() {
// 			fs.writeFileSync("/", "Hello");
// 		}).should.throw();
// 		(function() {
// 			fs.rmdirSync("/");
// 		}).should.throw();
// 		(function() {
// 			fs.unlinkSync("/");
// 		}).should.throw();
// 		(function() {
// 			fs.mkdirSync("/test/dir");
// 		}).should.throw();
// 		(function() {
// 			fs.mkdirSync("/test/file");
// 		}).should.throw();
// 		(function() {
// 			fs.mkdirpSync("/test/file");
// 		}).should.throw();
// 		(function() {
// 			fs.readdirSync("/test/file");
// 		}).should.throw();
// 		fs.readdirSync("/test/").should.be.eql(["dir", "file"]);
// 	});
// 	it("should throw on readlink", function() {
// 		var fs = new VirtualFS();
// 		fs.mkdirpSync("/test/dir");
// 		(function() {
// 			fs.readlinkSync("/");
// 		}).should.throw();
// 		(function() {
// 			fs.readlinkSync("/link");
// 		}).should.throw();
// 		(function() {
// 			fs.readlinkSync("/test");
// 		}).should.throw();
// 		(function() {
// 			fs.readlinkSync("/test/dir");
// 		}).should.throw();
// 		(function() {
// 			fs.readlinkSync("/test/dir/link");
// 		}).should.throw();
// 	});
// });
// describe("async", function() {
// 	["stat", "readdir", "mkdirp", "rmdir", "unlink", "readlink"].forEach(function(methodName) {
// 		it("should call " + methodName + " callback in a new event cycle", function(done) {
// 			var fs = new VirtualFS();
// 			var isCalled = false;
// 			fs[methodName]('/test', function() {
// 				isCalled = true;
// 				done();
// 			});
// 			should(isCalled).be.eql(false);
// 		});
// 	});
// 	["mkdir", "readFile"].forEach(function(methodName) {
// 		it("should call " + methodName + " a callback in a new event cycle", function(done) {
// 			var fs = new VirtualFS();
// 			var isCalled = false;
// 			fs[methodName]('/test', {}, function() {
// 				isCalled = true;
// 				done();
// 			});
// 			should(isCalled).eql(false);
// 		});
// 	});
// 	it("should be able to use the async versions", function(done) {
// 		var fs = new VirtualFS();
// 		fs.mkdirp("/test/dir", function(err) {
// 			if(err) throw err;
// 			fs.writeFile("/test/dir/a", "Hello", function(err) {
// 				if(err) throw err;
// 				fs.writeFile("/test/dir/b", "World", "utf-8", function(err) {
// 					if(err) throw err;
// 					fs.readFile("/test/dir/a", "utf-8", function(err, content) {
// 						if(err) throw err;
// 						content.should.be.eql("Hello");
// 						fs.readFile("/test/dir/b", function(err, content) {
// 							if(err) throw err;
// 							content.should.be.eql(new Buffer("World"));
// 							fs.exists("/test/dir/b", function(exists) {
// 								exists.should.be.eql(true);
// 								done();
// 							});
// 						});
// 					});
// 				});
// 			});
// 		});
// 	});
// 	it("should return errors", function(done) {
// 		var fs = new VirtualFS();
// 		fs.readFile("/fail/file", function(err, content) {
// 			err.should.be.instanceof(Error);
// 			fs.writeFile("/fail/file", "", function(err) {
// 				err.should.be.instanceof(Error);
// 				done();
// 			});
// 		});
// 	});
// });
// describe("streams", function() {
// 	describe("writable streams", function() {
// 		it("should write files", function() {
// 			var fs = new VirtualFS();
// 			fs.createWriteStream("/file").end("Hello");
// 			fs.readFileSync("/file", "utf8").should.be.eql("Hello");
// 		});
// 		it("should zero files", function() {
// 			var fs = new VirtualFS();
// 			fs.createWriteStream("/file").end();
// 			fs.readFileSync("/file", "utf8").should.be.eql("");
// 		});
// 		it("should accept pipes", function(done) {
// 			// TODO: Any way to avoid the asyncness of this?
// 			var fs = new VirtualFS();
// 			bl(new Buffer("Hello"))
// 				.pipe(fs.createWriteStream("/file"))
// 				.once('finish', function() {
// 					fs.readFileSync("/file", "utf8").should.be.eql("Hello");
// 					done();
// 				});
// 		});
// 		it("should propagate errors", function(done) {
// 			var fs = new VirtualFS();
// 			var stream = fs.createWriteStream("/file/unknown");
// 			var err = false;
// 			stream.once('error', function() {
// 				err = true;
// 			}).once('finish', function() {
// 				err.should.eql(true);
// 				done();
// 			});
// 			stream.end();
// 		});
// 	});
// 	describe("readable streams", function() {
// 		it("should read files", function(done) {
// 			var fs = new VirtualFS();
// 			fs.writeFileSync("/file", "Hello");
// 			fs.createReadStream("/file").pipe(bl(function(err, data) {
// 				data.toString('utf8').should.be.eql("Hello");
// 				done();
// 			}));
// 		});
// 		it("should respect start/end", function(done) {
// 			var fs = new VirtualFS();
// 			fs.writeFileSync("/file", "Hello");
// 			fs.createReadStream("/file", {
// 				start: 1,
// 				end: 3
// 			}).pipe(bl(function(err, data) {
// 				data.toString('utf8').should.be.eql("el");
// 				done();
// 			}));
// 		});
// 		it("should propagate errors", function(done) {
// 			var fs = new VirtualFS();
// 			var stream = fs.createReadStream("file");
// 			var err = false;
// 			// Why does this dummy event need to be here? It looks like it
// 			// either has to be this or data before the stream will actually
// 			// do anything.
// 			stream.on('readable', function() { }).on('error', function() {
// 				err = true;
// 			}).on('end', function() {
// 				err.should.eql(true);
// 				done();
// 			});
// 			stream.read(0);
// 		});
// 	});
// });
