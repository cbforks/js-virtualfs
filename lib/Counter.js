// this will be the counter management for allocating and deallocating
// inode indexes and file descriptor indexes
// we will use a bitmap tree
// each bitmap will

const BitSet = require('bitset.js');

// data BitMapTree = Node BitSet (Array BitMapTree) | Leaf BitSet
// BitSet appears to be a sequence of 32 bit integers
// not 64 bits? strange?
// but the total size is 10 32 bit integers?
// why 32 bit?
// it apppears to by dynamic
// so a.msb() is infinity if there are no bits set
// a.lsb() is always 0 though as it is the rightmost
// not sure?
// if you set the 100th bit, then the size is now equal to 100 bits
// when toString
// setting 32 is setting the 33rd bit, and so each one is actually 32 bits underneath?
// all functions are bitset.prototype (set, get, and, or, not, xor, flip, andNot, clear, slice, setRange, clone, toArray, toString, isEmpty, cardinality, msb, ntz, lsb, equals)
// they have fixed their word length to be 32 bits, so it's just an internal issue
// lol their toString does actual truncation
// ok I get it
// ctz(x) = ffs(x) - 1
// w bits
// ok so we shall need to limit it to a certain word size?
// how to do that?
// we can use a Uint8Array
// however that only gives us 8 bits
// I want 64 bits but it doesn't even accept Uint32Array
// what the hell..
// 4 * 8 = 32
// so new Uint8Array(4) is an array of 4 of 8 bit integers
// when passed into bs, this results in a data of 0, 0
// why does it scale when I use 4 ints?
// because i asked for 32, and it notices it filled 32, so it doubles to 64
// indexed from 0, then ctz(x) = ffs(x)
// I want to count the first 0, so I need to invert it right?

// trailing zeros!?!?
// a = new bs(new Uint8Array(4))
// a.ntz() == infinity
// a.set(0, 1)
// a.ntz() == 0
// that shows that 0 is the first set

// a = new bs(new Uint8Array(4)).flip()
// a.ntz() === 0 // first unallocated is 0 + 1 = 1
// a.set(0, 0) // allocate 1
// a.ntz() === 1 // next unallocated is 1 + 1 = 2
// a.set(1, 0) // allocate 2
// a.ntz() === 2 // next unallocated is 2 + 1 = 3

// a.set(3, 0) // allocate 4 (for some reason)
// a.ntz(0) === 2 // next unallocated 2 + 1 = 3
// wooo it works
// a.set(2, 0)

// a.set(63, 0)

// ok that works

// how do we know when to expand
// when the number it gives us is equal to infinity
// when it ntz() equals infinity that's when we need to update
// actually it should be returning 64, but the library returns infinity
// so what we can do is wait for 63, meaning the next number is 64 and we allocate 64 by setting 63
// so we then add before this happens
// so we can set it before it happens


// BitSet will allocate based on 32 bit sized blocks
// we subtract 1 before the desired block size
// this ensures that BitSet doesn't add one more 32 bit sized block
// because we're using ffz and not ffs, then we invert so that ntz == ffz


function setupBitMapConstructors (blockSize) {

  var BitMapTree = class BitMapTree {
    constructor () {
      this.bitMap = new BitSet(new Uint8Array(blockSize / 8 - 1)).flip();
      this.parentNode = null;
      this.parentIndex = null;
    }
    setParentNodeIndex (node, index) {
      this.parentNode = node;
      this.parentIndex = index;
    }
    set (i) {
      this.bitMap.set(i, 0);
      if (this.parentNode) {
        return this.parentNode.set(this.parentIndex);
      } else {
        return undefined;
      }
    }
    unset (i) {
      this.bitMap.set(i, 1);
      if (this.parentNode) {
        return this.parentNode.unset(this.parentIndex);
      } else {
        return undefined;
      }
    }
  };

  var Node = class Node extends BitMapTree {
    constructor (bitMapTrees) {
      super();
      bitMapTrees.forEach(function (t, i) {
        t.setParentNodeIndex(this, i);
      });
      this.bitMapTrees = bitMapTrees;
    }
    addChild (child) {
      if (this.bitMapTrees.length === this.blockSize) {
        throw new RangeError('Cannot add child to full node block in BitMapTree');
      }
      this.bitMapTrees.push(child);
      let i = this.bitMapTrees.length - 1;
      child.setParentNodeIndex(this, i);
      return i;
    }
    ffz () {
      let i = this.bitMap.ntz();
      if (i === Infinity) {
        return null;
      }
      return this.bitMapTrees[i].ffz();
    }
  };

  var Leaf = class Leaf extends BitMapTree {
    constructor (beginMark) {
      super();
      this.beginMark = beginMark;
    }
    ffz () {
      let i = this.bitMap.ntz();
      if (i === Infinity) {
        return null;
      }
      return { index: this.beginMark + i, leaf: this };
    }
  };

  return {
    Node: Node,
    Leaf: Leaf
  };

}

class Counter {

  constructor (begin, blockSize) {
    if (blockSize && blockSize % 8 !== 0) {
      throw TypeError('Blocksize for BitMapTree must be a multiple of 8');
    } else {
      blockSize = 64;
    }
    this._bitMapConst = setupBitMapConstructors(blockSize);
    this._bitMapTree = new this._bitmapConst.Leaf(begin);
  }

  allocate () {

    // begin what is it now?

    let unallocated = this._bitmapTree.ffz();
    if (!unallocated) {

      this._bitMapTree.addChild();

      this._bitmapTree = new Node([
        this._bitmapTree,
        new this._bitmapConst.Leaf(/* */)
      ]);
    }

    unallocated.leaf.set(unallocated.index);

    // we need to expand here if necessary
    // before it is required


    // problems:
    // 1. keeping track of the begin or numbers that each bitmap represents
    // 2. updating the tree from the leaf to the root when allocating or deallocating
    // 3. given a counter index, how to find the child node that is holding it
    // 4. building up the tree dynamically

    return unallocated.index;

  }

  deallocate (allocatedIndex) {

    allocatedIndex = allocatedIndex - this._begin;

    // re-explode into the path
    let allocatedPath = [];

    // a number depends on a multiple
    // so < 64 will result in just [63]
    // but greater than that we need to split it up
    // the pattern
    // this is basically unfold
    // the function returns Nothing i f it is done producing
    // or returns Just (a, b)
    // a is prepended to the list, and b is used as the next eleemtn in the recursive call
    // nothing will be returned when the number is exhausted
    // so in this case it is let val = acc - (x / (Math.pow(blockSize, ind)))

    // as the tree size changes, the path no longer represents the same thing
    // so the index number is still constant though

    this._bitmapTree.unset(allocatedPath);

  }

}

module.exports = Counter;
