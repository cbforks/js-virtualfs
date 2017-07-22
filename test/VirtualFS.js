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

test('can make and remove files - sync', (t) => {
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

test('multiple hardlinks to the same file - sync', (t) => {
  const fs = new VirtualFS;
  fs.mkdirSync('/test');
  fs.writeFileSync('/test/a');
  fs.linkSync('/test/a', '/test/b');
  const inoA = fs.statSync('/test/a').ino;
  const inoB = fs.statSync('/test/b').ino;
  t.is(inoA, inoB);
  t.deepEqual(fs.readFileSync('/test/a'), fs.readFileSync('/test/b'));
});

test('should not create hardlinks to directories - sync', (t) => {
  const fs = new VirtualFS;
  fs.mkdirSync('/test');
  const error = t.throws(() => {
    fs.linkSync('/test', '/hardlinkttotest');
  });
  t.is(error.code, 'EPERM');
});

test('is able to add and traverse symlinks transitively - sync', (t) => {
  const fs = new VirtualFS;
  fs.mkdirSync('/test');
  const buf = new Buffer('Hello World', 'utf-8');
  fs.writeFileSync('/test/hello-world.txt', buf);
  fs.symlinkSync('/test', '/linktotestdir');
  t.is(fs.readlinkSync('/linktotestdir'), '/test');
  t.deepEqual(fs.readdirSync('/linktotestdir'), ['hello-world.txt']);
  fs.symlinkSync('/linktotestdir/hello-world.txt', '/linktofile');
  fs.symlinkSync('/linktofile', '/linktolink');
  t.is(fs.readFileSync('/linktofile', 'utf-8'), 'Hello World');
  t.is(fs.readFileSync('/linktolink', 'utf-8'), 'Hello World');
});

test('is able to traverse relative symlinks - sync', (t) => {
  const fs = new VirtualFS;
  fs.mkdirSync('/test');
  const buf = new Buffer('Hello World', 'utf-8');
  fs.writeFileSync('/a', buf);
  fs.symlinkSync('../a', '/test/linktoa');
  t.is(fs.readFileSync('/test/linktoa', 'utf-8'), 'Hello World');
});

test('unlink does not traverse symlinks - sync', (t) => {
  const fs = new VirtualFS;
  fs.mkdirSync('/test');
  const buf = new Buffer('Hello World', 'utf-8');
  fs.writeFileSync('/test/hello-world.txt', buf);
  fs.symlinkSync('/test', '/linktotestdir');
  fs.symlinkSync('/linktotestdir/hello-world.txt', '/linktofile');
  fs.unlinkSync('/linktofile');
  fs.unlinkSync('/linktotestdir');
  t.deepEqual(fs.readdirSync('/test'), ['hello-world.txt']);
});

test('should fail on invalid paths', (t) => {
  const fs = new VirtualFS;
  fs.mkdirpSync('/test/a/b/c');
  fs.mkdirpSync('/test/a/bc');
  fs.mkdirpSync('/test/abc');
  t.throws(() => {
    fs.readdirSync('/test/abc/a/b/c');
  });
  t.throws(() => {
    fs.readdirSync('/abc');
  });
  t.throws(() => {
    fs.statSync('/abc');
  });
  t.throws(() => {
    fs.mkdirSync('/test/a/d/b/c');
  });
  t.throws(() => {
    fs.writeFileSync('/test/a/d/b/c', 'Hello');
  });
  t.throws(() => {
    fs.readFileSync('/test/a/d/b/c');
  });
  t.throws(() => {
    fs.readFileSync('/test/abcd');
  });
  t.throws(() => {
    fs.mkdirSync('/test/abcd/dir');
  });
  t.throws(() => {
    fs.unlinkSync('/test/abcd');
  });
  t.throws(() => {
    fs.unlinkSync('/test/abcd/file');
  });
  t.throws(() => {
    fs.statSync('/test/a/d/b/c');
  });
  t.throws(() => {
    fs.statSync('/test/abcd');
  });
});

test('various failure modes - sync', (t) => {
  const fs = new VirtualFS;
  fs.mkdirpSync('/test/dir');
  fs.mkdirpSync('/test/dir');
  fs.writeFileSync('/test/file', 'Hello');
  t.throws(() => {
    fs.writeFileSync("/test/dir", "Hello");
  });
  t.throws(() => {
    fs.writeFileSync('/', 'Hello');
  });
  t.throws(() => {
    fs.rmdirSync('/');
  });
  t.throws(() => {
    fs.unlinkSync('/');
  });
  t.throws(() => {
    fs.mkdirSync('/test/dir');
  });
  t.throws(() => {
    fs.mkdirSync('/test/file');
  });
  t.throws(() => {
    fs.mkdirpSync('/test/file');
  });
  t.throws(() => {
    fs.readdirSync('/test/file');
  });
  t.throws(() => {
    fs.readlinkSync('/test/dir');
  });
  t.throws(() => {
    fs.readlinkSync('/test/file');
  });
});

test.cb('asynchronous errors passed to callbacks - sync', (t) => {
  const fs = new VirtualFS;
  fs.readFile('/nonexistent/', (err, content) => {
    t.true(err instanceof Error);
    fs.writeFile('/fail/file', '', (err) => {
      t.true(err instanceof Error);
      fs.mkdir('/cannot/do/this', (err) => {
        t.true(err instanceof Error);
        fs.readlink('/nolink', (err) => {
          t.true(err instanceof Error);
          t.end();
        });
      });
    });
  });
});

test('writable streams - sync', (t) => {
  const fs = new VirtualFS;
  const str = 'Hello';
  fs.createWriteStream('/file').end(str);
  t.is(fs.readFileSync('/file', 'utf-8'), str);
  fs.createWriteStream('/file').end();
  t.is(fs.readFileSync('/file', 'utf-8'), '');
});

test.cb('piping into a writable stream - async', (t) => {
  const fs = new VirtualFS;
  const str = 'Hello';
  bl(new Buffer(str)).pipe(fs.createWriteStream('/file')).once('finish', () => {
    t.is(fs.readFileSync('/file', 'utf-8'), str);
    t.end();
  });
});

test.cb('writable streams handle errors - async', (t) => {
  const fs = new VirtualFS;
  let stream = fs.createWriteStream('/file/unknown');
  let err = false;
  stream.once('error', () => {
    err = true;
  }).once('finish', () => {
    t.true(err);
    t.end();
  });
  stream.end();
});

test.cb('readable streams handle errors - async', (t) => {
  const fs = new VirtualFS;
  let stream = fs.createReadStream('/file');
  let err = false;
  stream.on('readable', () => {}).on('error', () => {
    err = true;
  }).on('end', () => {
    t.true(err);
    t.end();
  });
  stream.read(0);
});

test.cb('readable streams - async', (t) => {
  const fs = new VirtualFS;
  const str = 'Hello';
  fs.writeFileSync('/file', str);
  fs.createReadStream('/file').pipe(bl((err, data) => {
    t.is(data.toString('utf8'), str);
    t.end();
  }));
});

test.cb('readable streams respects start and end options', (t) => {
  const fs = new VirtualFS;
  const str = 'Hello';
  fs.writeFileSync('/file', str);
  fs.createReadStream('/file', {
    start: 1,
    end: 3
  }).pipe(bl((err, data) => {
    t.is(data.toString('utf8'), str.slice(1, 3));
    t.end();
  }));
});

test('directory file descriptor errors - sync', (t) => {
  const fs = new VirtualFS;
  fs.mkdirSync('/dir');
  const dirfd = fs.open('/dir');
  let error;
  const buf = new Buffer(10);
  error = t.throws(() => {
    fs.ftruncateSync(dirfd);
  });
  t.is(error.code, 'EINVAL');
  error = t.throws(() => {
    fs.readSync(dirfd, buf, 0, 10, null);
  });
  t.is(error.code, 'EISDIR');
  error = t.throws(() => {
    fs.writeSync(dirfd, buf);
  });
  t.is(error.code, 'EBADF');
  error = t.throws(() => {
    fs.readFileSync(dirfd);
  });
  t.is(error.code, 'EISDIR');
  error = t.throws(() => {
    fs.writeFileSync(dirfd, 'test');
  });
  t.is(error.code, 'EBADF');
  fs.closeSync(dirfd);
});

test.cb('opening and reading from file descriptor - async', (t) => {
  const fs = new VirtualFS;
  const str = 'Hello World';
  fs.writeFileSync('/test', str);
  fs.open('/test', 'r', (err, fd) => {
    t.ifError(err);
    const buffer = new Buffer(str.length);
    fs.read(fd, buffer, 0, buffer.length, null, (err, readSize, buffer) => {
      t.ifError(err);
      t.is(readSize, str.length);
      t.is(buffer.toString('utf8', 0, buffer.length), str);
      fs.close(fd, (err) => {
        t.ifError(err);
        t.end();
      });
    });
  });
});
