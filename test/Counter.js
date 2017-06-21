const should = require('should');
const Counter = require('../lib/Counter');

describe('Counter', function () {

  it('should allocate sequentially', function () {
    let startingOffset = 10;
    let c = new Counter(startingOffset);
    for (var i = 10; i < 1000; ++i) {
      c.allocate().should.be.eql(i);
    }
  });

  it('should reuse deallocated counters sequentially', function () {
    let c = new Counter();
    let first = c.allocate();
    c.allocate();
    let third = c.allocate();
    c.allocate();
    let fifth = c.allocate();
    let last;
    for (var i = 0; i < 200; ++i) {
      last = c.allocate();
    }
    c.deallocate(first);
    c.deallocate(third);
    c.deallocate(fifth);
    c.allocate().should.be.eql(first);
    c.allocate().should.be.eql(third);
    c.allocate().should.be.eql(fifth);
    c.allocate().should.be.eql(last + 1);
  });

  // shrinking performance tests rely on internal behaviour of the Counter

  it('should be able to shrink', function () {
    let blockSize = 32;
    let c = new Counter(0, blockSize, 1);
    let i;
    // allocate 2 * block size
    for (i = 0; i < blockSize * 2; ++i) {
      c.allocate();
    }
    c._bitMapTree.bitMapTrees.length.should.be.eql(2);
    // deallocate the second terminal block
    for (i = blockSize; i < blockSize * 2; ++i) {
      c.deallocate(i);
    }
    // terminal block should be deleted
    c._bitMapTree.bitMapTrees.length.should.be.eql(1);
    c.allocate().should.be.eql(blockSize);
    c._bitMapTree.bitMapTrees.length.should.be.eql(2);
    c.allocate().should.be.eql(blockSize + 1);
    // deallocate the first block
    for (i = 0; i < blockSize; ++i) {
      c.deallocate(i);
    }
    // initial block should not be deleted
    c._bitMapTree.bitMapTrees.length.should.be.eql(2);
    c.allocate().should.be.eql(0);

  });

  it('should be able to shrink and propagate up the tree', function () {
    let blockSize = 32;
    let c = new Counter(0, blockSize, true);
    let i;
    // allocate to depth 2, but multiply by 2 requiring 2 branches
    for (i = 0; i < Math.pow(blockSize, 2) * 2; ++i) {
      c.allocate();
    }
    c._bitMapTree.bitMapTrees.length.should.be.eql(2);
    // deallocate second half of the second branch
    for (i = (Math.pow(blockSize, 2) * 1.5); i < Math.pow(blockSize, 2) * 2; ++i) {
      c.deallocate(i);
    }
    c._bitMapTree.bitMapTrees.length.should.be.eql(2);
    // now deallocate first half of the second branch
    for (i = Math.pow(blockSize, 2); i < Math.pow(blockSize, 2) * 1.5; ++i) {
      c.deallocate(i);
    }
    c._bitMapTree.bitMapTrees.length.should.be.eql(1);
    c.allocate().should.be.eql(Math.pow(blockSize, 2));
    c._bitMapTree.bitMapTrees.length.should.be.eql(2);
  });

  it('should be able to shrink and grow at any leaf', function () {
    let blockSize = 32;
    let c = new Counter(0, blockSize, true);
    let i;
    // allocate to depth 2, but multiply by 2 requiring 2 branches
    for (i = 0; i < Math.pow(blockSize, 2) * 2; ++i) {
      c.allocate();
    }
    c._bitMapTree.bitMapTrees.length.should.be.eql(2);
  });

});
