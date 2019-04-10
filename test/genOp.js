/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS202: Simplify dynamic range loops
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
let genRandomOp;
const {randomInt, randomReal, randomWord} = require('ot-fuzzer');
// require 'ot-fuzzer'

const assert = require('assert');
const {writeCursor} = require('../lib/cursor');
const log = require('../lib/log');
const {type} = require('../lib/json1');


// This is an awful function to clone a document snapshot for use by the random
// op generator. .. Since we don't want to corrupt the original object with
// the changes the op generator will make.
const clone = function(o) { if (typeof o === 'object') { return JSON.parse(JSON.stringify(o)); } else { return o; } };

const randomKey = function(obj) { // this works on arrays too!
  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      return undefined;
    } else {
      return randomInt(obj.length);
    }
  } else {
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      return undefined;
    } else {
      return keys[randomInt(keys.length)];
    }
  }
};

const letters = 'abxyz';

// Generate a random new key for a value in obj.
const randomNewKey = function(obj) {
  if (Array.isArray(obj)) {
    return randomInt(obj.length + 1);
  } else {
    let key;
    while (true) {
      // Mostly try just use a small letter
      key = randomInt(20) === 0 ? randomWord() : letters[randomInt(letters.length)];
      if (obj[key] === undefined) { break; }
    }
    return key;
  }
};

// Generate a random object
var randomThing = function() {
  switch (randomInt(7)) {
    case 0: return null;
    case 1: return '';
    case 2: return randomWord();
    case 3:
      var obj = {};
      for (let i = 1, end = randomInt(2), asc = 1 <= end; asc ? i <= end : i >= end; asc ? i++ : i--) { obj[randomNewKey(obj)] = randomThing(); }
      return obj;
    case 4: return (__range__(1, randomInt(2), true).map((j) => randomThing()));
    case 5: return 0; // bias toward zeros to find accidental truthy checks
    case 6: return randomInt(50);
  }
};

// Pick a random path to something in the object.
const randomPath = function(data) {
  if ((data == null) || (typeof data !== 'object')) { return []; }

  const path = [];
  while ((randomReal() < 0.9) && (data != null) && (typeof data === 'object')) {
    const key = randomKey(data);
    if (key == null) { break; }

    path.push(key);
    data = data[key];
  }

  return path;
};

const randomWalkPick = function(w, container) {
  const path = randomPath(container.data);
  let parent = container;
  let key = 'data';
  //log 'rwp', container, path, parent

  for (let p of Array.from(path)) {
    parent = parent[key];
    key = p;
    w.descend(key);
  }
  const operand = parent[key];
  return [path, parent, key, operand];
};

// Returns [path, parent, key] if we can drop here, or null if no drop is
// possible
const randomWalkDrop = function(w, container) {
  if (container.data === undefined) {
    return [[], container, 'data'];
  } else if ((typeof container.data !== 'object') || (container.data === null)) {
    return null; // Can't insert into a document that is a string or number
  }

  let [path, parent, key, operand] = Array.from(randomWalkPick(w, container));
  if ((typeof operand === 'object') && (operand !== null)) {
    parent = operand;
  } else {
    w.ascend();
    w.reset();
    path.pop();
  }
  key = randomNewKey(parent);
  // log 'key', key
  return [path, parent, key];
};

const set = function(container, key, value) {
  if (value === undefined) {
    if (Array.isArray(container)) {
      return container.splice(key, 1);
    } else {
      return delete container[key];
    }
  } else {
    if (Array.isArray(container)) {
      return container.splice(key, 0, value);
    } else {
      return container[key] = value;
    }
  }
};

const genRandomOpPart = function(data) {
  // log 'genRandomOp', data

  let key1, parent1, path1;
  const container = {data};
  const w = writeCursor();

  // Remove something

  // Things we can do:
  // 0. remove something
  // 1. move something
  // 2. insert something
  // 3. edit a string
  const mode = (data === undefined) && (randomReal() < 0.9) ? 2 : randomInt(4);
  //mode = 1
  //log 'mode', mode
  switch (mode) {
    case 0: case 1:
      var [path, parent, key, operand] = Array.from(randomWalkPick(w, container));
      //log 'ppko', path, parent, key, operand
      if ((mode === 1) && (typeof operand === 'string')) {
        // Edit it!
        const genString = require('ot-text/test/genOp');
        const [stringOp, result] = Array.from(genString(operand));
        w.write('es', stringOp);
        parent[key] = result;
      } else if ((mode === 1) && (typeof operand === 'number')) {
        const increment = randomInt(10);
        w.write('ena', increment);
        parent[key] += increment;
      } else {
        // Remove it
        if (operand !== undefined) {
          w.write('r', true); //operand
          set(parent, key, undefined);
        }
      }
      break;

    case 2:
      // insert something
      var walk = randomWalkDrop(w, container);
      if (walk !== null) {
        [path, parent, key] = Array.from(walk);
        //log 'walk', walk
        const val = randomThing();
        if (parent !== container) { w.descend(key); }
        w.write('i', val);
        set(parent, key, clone(val));
      }
      break;

    case 3:
      // Move something. We'll pick up the current operand...
      [path1, parent1, key1, operand] = Array.from(randomWalkPick(w, container));
      if (operand !== undefined) {
        set(parent1, key1, undefined); // remove it from the result...

        if (parent1 === container) { // We're removing the whole thing.
          w.write('r', true);
        } else {
          w.write('p', 0);

          // ... and find another place to insert it!
          for (let i = 0, end = path1.length, asc = 0 <= end; asc ? i < end : i > end; asc ? i++ : i--) { w.ascend(); }
          w.reset();
          const [path2, parent2, key2] = Array.from(randomWalkDrop(w, container));
          w.descend(key2);
          set(parent2, key2, operand);
          w.write('d', 0);
        }
      }
      break;
  }

  const doc = container.data;
  const op = w.get();

  type.checkValidOp(op);

  // assert.deepEqual doc, type.apply clone(data), op

  return [op, doc];
};

module.exports = (genRandomOp = function(doc) {
  doc = clone(doc);

  // 90% chance of adding an op the first time through, then 50% each successive time.
  let chance = 0.99;

  let op = null; // Aggregate op

  while (randomReal() < chance) {
    let opc;
    [opc, doc] = Array.from(genRandomOpPart(doc));
    log(opc);
    // type.setDebug false
    op = type.compose(op, opc);

    chance = 0.5;
  }

  // log.quiet = false
  log('-> generated op', op, 'doc', doc);
  return [op, doc];
});

if (require.main === module) {
  // log genRandomOp {}
  // log genRandomOp({x:5, y:7, z:[1,2,3]}) for [1..10]
  for (let i = 1; i <= 10; i++) {
    type.debug = true;
    log.quiet = false;
    log(genRandomOp({x:"hi", y:'omg', z:[1,'whoa',3]}));
  }
}
    // log genRandomOp(undefined)

function __range__(left, right, inclusive) {
  let range = [];
  let ascending = left < right;
  let end = !inclusive ? right : ascending ? right + 1 : right - 1;
  for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
    range.push(i);
  }
  return range;
}