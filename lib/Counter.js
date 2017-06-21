const BitSet = require('bitset.js');

// ok we are going to create a lazy bitmap tree
// lazy creation and lazy growth
// when a tree is fully full
// a depth number is passed to the top and the root now contains the depth

function setupBitMapConstructors (blockSize) {

  let createBitMap = function () {
    return new BitSet(new Uint8Array(blockSize / 8 - 1)).flip(0, blockSize - 1);
  };

  let setBit = function (bitMap, i) {
    return bitMap.set(i, 0);
  };

  let unsetBit = function (bitMap, i) {
    return bitMap.set(i, 1);
  };

  let isSet = function (bitMap, i) {
    return !bitMap.get(i);
  };

  let allSet = function (bitMap) {
    return bitMap.isEmpty();
  };

  let allUnset = function (bitMap) {
    return bitMap.ntz() === 0;
  };

  let firstUnset = function (bitMap) {
    let first = bitMap.ntz();
    // if Infinity, all items are set, so return null
    if (first === Infinity) {
      first = null;
    }
    return first;
  };

  const BitMapTree = class BitMapTree {
    constructor (begin, depth) {
      this.begin = begin;
      this.depth = depth;
      this.bitMap = createBitMap();
      this.parentNode = null;
      this.parentIndex = null;
    }
    setParentNodeIndex (node, index) {
      this.parentNode = node;
      this.parentIndex = index;
    }
    set (index) {
      if (!isSet(this.bitMap, index)) {
        setBit(this.bitMap, index);
        // only set the parent if all is now set
        if (this.parentNode && allSet(this.bitMap)) {
          this.parentNode.set(this.parentIndex);
        }
      }
      return;
    }
    unset (index) {
      if (isSet(this.bitMap, index)) {
        let allSetPrior = allSet(this.bitMap);
        unsetBit(this.bitMap, index);
        // only unset the parent if all were previously set
        if (this.parentNode && allSetPrior) {
          this.parentNode.unset(this.parentIndex);
        }
      }
      return;
    }
  };

  const Leaf = class Leaf extends BitMapTree {

    constructor (begin) {
      super(begin, 0);
    }

    firstUnsetCounter () {
      let index = firstUnset(this.bitMap);
      if (index !== null) {
        return { counter: this.begin + index, index: index, leaf: this };
      } else {
        return null;
      }
    }

    lookupCounter (counter) {
      let index = Math.floor(
        (counter - this.begin) / Math.pow(blockSize, this.depth)
      );

      if (index >= 0 && index < blockSize) {
        return { index: index, leaf: this };
      } else {
        return null;
      }
    }
  };

  const Node = class Node extends BitMapTree {

    constructor (begin, depth) {
      super(begin, depth);
      this.bitMapTrees = [];
    }

    addChild (child) {
      let index = this.bitMapTrees.push(child) - 1;
      child.setParentNodeIndex(this, index);
      if (allSet(child.bitMap)) setBit(this.bitMap, index);
    }

    firstUnsetCounter () {
      let index = firstUnset(this.bitMap);
      if (index === null) {
        return null;
      } else if (this.bitMapTrees[index]) {
        return this.bitMapTrees[index].firstUnsetCounter();
      } else {
        let newBegin;
        if (this.bitMapTrees.length) {
          newBegin =
            this.bitMapTrees[this.bitMapTrees.length - 1].begin +
            Math.pow(blockSize, this.depth);
        } else {
          newBegin = this.begin;
        }
        let newDepth = this.depth - 1;
        let child;
        if (newDepth === 0) {
          child = new Leaf(newBegin);
        } else {
          child = new Node(newBegin, newDepth);
        }
        this.addChild(child);
        return child.firstUnsetCounter();
      }
    }

    lookupCounter (counter) {
      let index = Math.floor(
        (counter - this.begin) / Math.pow(blockSize, this.depth)
      );
      if (this.bitMapTrees[index]) {
        return this.bitMapTrees[index].lookupCounter(counter);
      } else {
        return null;
      }
    }

  };

  return {
    Leaf: Leaf,
    Node: Node
  };

}

class Counter {

  constructor (begin, blockSize) {

    if (typeof begin === 'undefined') begin = 0;

    if (blockSize && blockSize % 32 !== 0) {
      throw TypeError('Blocksize for BitMapTree must be a multiple of 32');
    } else {
      blockSize = 64;
    }

    this._begin = begin;
    this._bitMapConst = setupBitMapConstructors(blockSize);
    this._bitMapTree = new this._bitMapConst.Leaf(0);

  }

  allocate () {

    let unallocated = this._bitMapTree.firstUnsetCounter();
    if (unallocated) {

      unallocated.leaf.set(unallocated.index);
      return this._begin + unallocated.counter;

    } else {

      // grow the tree
      let newRoot = new this._bitMapConst.Node(
        this._bitMapTree.begin,
        this._bitMapTree.depth + 1
      );
      newRoot.addChild(this._bitMapTree);
      this._bitMapTree = newRoot;

      // should only recurse once
      return this.allocate();

    }

  }

  deallocate (counter) {

    counter = counter - this._begin;
    let allocated = this._bitMapTree.lookupCounter(counter);
    if (allocated) {
      allocated.leaf.unset(allocated.index);
    }
    // if null, number hasn't been allocated yet, so it is fine to return
    return;

  }

}

module.exports = Counter;
