const BitSet = require('bitset.js');

/**
 * Parameterises the bitmap tree contructors by the block size
 * The block size is the size of each bitmap
 * @param {number} blockSize
 * @returns {{Leaf: Leaf, Node: Node}}
 */
function setupBitMapConstructors (blockSize) {

  // bitset library uses 32 bits numbers internally
  // it preemptively adds an extra number whan it detects it's full
  // this is why we use Uint8Array and minus 1 from the blocksize / 8
  // in order to get exactly the right size
  // because of the functions supplied by the bitset library
  // we invert the notions of set and unset where
  // set is 0 and unset is 1
  // in the future if bitset library gets changed
  // these adapter functions may need to change

  /**
   * Creates a new bitmap sized according to the block size
   * @returns {BitSet}
   */
  let createBitMap = function () {
    return new BitSet(new Uint8Array(blockSize / 8 - 1)).flip(0, blockSize - 1);
  };

  /**
   * Set a bit
   * @param {BitSet} bitMap
   * @param {number} i
   * @returns {BitSet}
   */
  let setBit = function (bitMap, i) {
    return bitMap.set(i, 0);
  };

  /**
   * Unsets a bit
   * @param {BitSet} bitMap
   * @param {number} i
   * @returns {BitSet}
   */
  let unsetBit = function (bitMap, i) {
    return bitMap.set(i, 1);
  };

  /**
   * Checks if a bit is set
   * @param {BitSet} bitMap
   * @param {number} i
   * @returns {bool}
   */
  let isSet = function (bitMap, i) {
    return !bitMap.get(i);
  };

  /**
   * Checks if the entire bitmap is set
   * @param {BitSet} bitMap
   * @returns {bool}
   */
  let allSet = function (bitMap) {
    return bitMap.isEmpty();
  };

  /**
   * Checks if the entire bitmap is unset
   * @param {BitSet} bitMap
   * @returns {bool}
   */
  let allUnset = function (bitMap) {
    return bitMap.cardinality() === blockSize;
  };

  /**
   * Find first set algorithm
   * If null is returned, all items have been set
   * @param {BitSet} bitMap
   * @returns {number|null}
   */
  let firstUnset = function (bitMap) {
    let first = bitMap.ntz();
    if (first === Infinity) {
      first = null;
    }
    return first;
  };

  /**
   * Class representing a lazy recursive bitmap tree
   * Only the leaf bitmaps correspond to counters
   * Interior bitmaps index their child bitmaps
   * If an interior bit is set, that means there's no free bits in the child bitmap
   * If an interior bit is not set, that means there's at least 1 free bit in the child bitmap
   */
   class BitMapTree {

    /**
     * Creates a BitMapTree, this is an abstract class
     * It is not meant to by directly instantiated
     * @param {number} begin
     * @param {number} depth
     */
    constructor (begin, depth) {
      this.begin = begin;
      this.depth = depth;
      this.bitMap = createBitMap();
      this.parentNode = null;
      this.parentIndex = null;
    }

    /**
     * Sets the parent pointers
     * @param {BitMapTree} node
     * @param {number} index
     */
    setParentNodeIndex (node, index) {
      this.parentNode = node;
      this.parentIndex = index;
    }

    /**
     * Sets a bit to allocated
     * This may propagate up the bit state to the parent interior nodes
     * @param {number} index
     */
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

    /**
     * Unsets a bit so that is free
     * This may propagate the bit state to the parent interior nodes
     * @param {number} index
     */
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

  /**
   * Class representing a Leaf of the recursive bitmap tree
   * This represents the base case of the lazy recursive bitmap tree
   * @extends BitMapTree
   */
  class Leaf extends BitMapTree {

    /**
     * Creates a Leaf
     * @param {number} begin
     */
    constructor (begin) {
      super(begin, 0);
    }

    /**
     * Find the first unset bit
     * @returns {Object|null}
     */
    firstUnsetCounter () {
      let index = firstUnset(this.bitMap);
      if (index !== null) {
        return { counter: this.begin + index, index: index, leaf: this };
      } else {
        return null;
      }
    }

    /**
     * Find the bit corresponding to the counter
     * @param {number} counter
     * @returns {Object|null}
     */
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

  /**
   * Class representing a Node of the recursive bitmap tree
   * @extends BitMapTree
   */
  class Node extends BitMapTree {

    /**
     * Creates a Node
     * @param {number} begin
     * @param {number} depth
     */
    constructor (begin, depth) {
      super(begin, depth);
      this.bitMapTrees = [];
    }

    /**
     * Pushes a child node or leaf to the end of this bitmap
     * @param {Leaf|Node} child
     */
    pushChild (child) {
      let index = this.bitMapTrees.push(child) - 1;
      child.setParentNodeIndex(this, index);
      if (allSet(child.bitMap)) setBit(this.bitMap, index);
    }

    /**
     * Pops a child node or leaf from the end of this bitmap
     */
    popChild () {
      if (this.bitMapTrees.length) {
        let lastChild = this.bitMapTrees[this.bitMapTrees.length - 1];
        if (allUnset(lastChild.bitMap)) {
          this.bitMapTrees.pop();
          if (this.parentNode) {
            this.parentNode.popChild();
          }
        }
      }
    }

    /**
     * Find the first unset bit and traverse the child
     * If the child pointer is undefined, then it will lazily create the child
     * @returns {Object|null}
     */
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
            this.bitMapTrees[index - 1].begin +
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
        this.pushChild(child);
        return child.firstUnsetCounter();
      }
    }

    /**
     * Find the bit corresponding to the counter and traverse the child
     * @param {number} counter
     * @returns {Object|null}
     */
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

/**
 * Class representing allocatable and deallocatable counters
 * Counters are allocated in sequential manner, this applies to deallocated counters
 * Once a counter is deallocated, it will be reused on the next allocation
 */
class Counter {

  /**
   * Creates a counter instance
   * If shrinking is allowed, this will automatically shrink the bitmap tree
   * Shrinking is done from the terminal leaf or interior node first
   * Shrinking is not necessary unless you want to optimise memory usage
   * and that you expect to deallocate without allocating again
   * @param {number} [begin] - Defaults to 0
   * @param {number} [blockSize] - Must be a multiple of 32, defaults to 32
   * @param {bool} [allowShrinking] - Defaults to false
   * @throws {TypeError} - Will throw if blockSize is not a multiple of 32
   */
  constructor (begin, blockSize, allowShrinking) {

    if (typeof begin === 'undefined') begin = 0;
    if (blockSize && blockSize % 32 !== 0) {
      throw TypeError('Blocksize for BitMapTree must be a multiple of 32');
    } else {
      // JavaScript doesn't yet have 64 bit numbers so we default to 32
      blockSize = 32;
    }
    if (typeof allowShrinking === 'undefined') allowShrinking = false;
    this._begin = begin;
    this._allowShrinking = allowShrinking;
    this._bitMapConst = setupBitMapConstructors(blockSize);
    this._bitMapTree = new this._bitMapConst.Leaf(0);

  }

  /**
   * Allocates a number sequentially
   * Numbers may be reused
   * @returns {number}
   */
  allocate () {
    let unallocated = this._bitMapTree.firstUnsetCounter();
    if (unallocated) {
      unallocated.leaf.set(unallocated.index);
      return this._begin + unallocated.counter;
    } else {
      let newRoot = new this._bitMapConst.Node(
        this._bitMapTree.begin,
        this._bitMapTree.depth + 1
      );
      newRoot.pushChild(this._bitMapTree);
      this._bitMapTree = newRoot;
      return this.allocate();
    }
  }

  /**
   * Deallocates a number, it makes it available for reuse
   * @param {number} counter
   */
  deallocate (counter) {
    counter = counter - this._begin;
    let allocated = this._bitMapTree.lookupCounter(counter);
    if (allocated) {
      allocated.leaf.unset(allocated.index);
      if (this._allowShrinking && allocated.leaf.parentNode) {
        allocated.leaf.parentNode.popChild();
      }
    }
    return;
  }

}

module.exports = Counter;
