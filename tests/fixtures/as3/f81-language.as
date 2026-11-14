import flash.utils.*;
import flash.system.fscommand;
import flash.display.*;
import flash.events.*;

// ---- values and their defaults
var aN:Number; var aI:int; var aU:uint; var aB:Boolean; var aS:String; var aO:Object; var aA:Array; var aX:*; var aF:Function; var aD:Date; var aM:MovieClip;
trace("defaults", aN, aI, aU, aB, aS, aO, aA, aX, aF, aD, aM);
trace("numbers", 1.0, 0.1 + 0.2, 1e21, 1e-7, 100000000000000000000, 123456789012345680000, -0, 1 / 0, -1 / 0, 0 / 0, 2.5e3, 0x10, 010);
trace(1 / 3, 2 / 3, 10 / 3, 1.1 * 3, 1e300 * 1e10, 5 % 3, -5 % 3, 5 % -3, 5.5 % 2, 2147483647 + 1);

// ---- conversions
trace("int", int(3.7), int(-3.7), int("12"), int("12abc"), int("abc"), int(null), int(undefined), int(true), int(4294967296), int(2147483648), int(1e10));
trace("uint", uint(3.7), uint(-1), uint("12"), uint(4294967296), uint(-4294967297));
trace("Number", Number("12.5"), Number("abc"), Number(""), Number(" 7 "), Number(null), Number(undefined), Number(true), Number("0x10"), Number([]), Number([5]), Number([1, 2]));
trace("String", String(null), String(undefined), String(1.5), String(true), String([1, 2]), String({}), String(new Date(0).getTime()));
trace("Boolean", Boolean(0), Boolean(1), Boolean(""), Boolean("0"), Boolean(null), Boolean(undefined), Boolean(NaN), Boolean([]), Boolean({}));
var vi:int = 3.9; var vu:uint = -5; var vn:Number = "2.5"; var vs:String = 12; var vb:Boolean = "x"; var vs2:String = null; var vs3:String = undefined;
trace("assigned", vi, vu, vn, vs, vb, vs2, vs3);
vi = "7"; vi += 1.9; trace(vi); vi /= 2; trace(vi); vu = 1; vu -= 2; trace(vu); vi = 2147483647; vi++; trace(vi); vi = -2147483648; vi--; trace(vi); vu = 0; vu--; trace(vu); vu++; trace(vu);
function typed(a:int, b:String = "d", c:Number = 1.5, ...rest):String { return [a, b, c, rest.length].join(" "); }
trace("params", typed(3.9), typed(1.2, null), typed(0, 5, "2", 1, 2, 3));
function back():int { return 3.9; } function backS():String { return 5; } function backN():Number { return "x"; } function noret():void {}
trace("returns", back(), backS(), backN(), noret());

// ---- operators
trace("plus", "5" + 2, 5 + "2", "5" * 2, "5" - 2, "a" * 2, null + 1, undefined + 1, true + 1, [] + 1, [1] + [2], {} + "", null + "x", undefined + "x");
trace("compare", null == undefined, null === undefined, "1" == 1, "1" === 1, 0 == false, "" == false, "" == 0, null == 0, NaN == NaN, [] == [], "abc" < "abd", "10" < "9", "10" < 9, null < 1, undefined < 1);
trace("logic", 0 || "x", 1 || "x", 0 && "x", 1 && "x", !0, !"", !"a", null || undefined, "" || 0);
trace("bits", 5 & 3, 5 | 3, 5 ^ 3, ~5, 1 << 31, 1 << 32, -1 >> 1, -1 >>> 1, -1 >>> 0, 2.9 | 0, "6" & 3, null | 1);
trace("typeof", typeof 1, typeof "s", typeof true, typeof null, typeof undefined, typeof {}, typeof [], typeof trace, typeof Sprite, typeof new Sprite(), typeof aN, typeof aS);
trace("is", 1 is int, 1 is Number, 1.5 is int, 1.5 is Number, -1 is uint, "s" is String, null is Object, [] is Array, [] is Object, new Sprite() is DisplayObject, new Sprite() is MovieClip, 1 is Object);
trace("as", 1 as String, "s" as String, [] as Array, null as Array, new Sprite() as MovieClip, new Sprite() as DisplayObject != null);
trace("in", "a" in {a: 1}, "b" in {a: 1}, 0 in [1], 1 in [1], "length" in []);
var o:Object = {a: 1, b: {c: 2}}; delete o.a; trace(o.a, o.b.c, o["b"]["c"], delete o.zz, o.hasOwnProperty("b"), o.hasOwnProperty("a"), o.propertyIsEnumerable("b"));
var cc:int = 5; cc += cc++ + ++cc; trace(cc); var dd:int = 1; dd <<= 3; dd >>= 1; dd |= 1; dd &= 7; dd ^= 2; dd %= 4; trace(dd);
trace((1, 2, 3), void 0, 1 > 0 ? "y" : "n", true ? false ? 1 : 2 : 3);

// ---- arrays
var ar:Array = [3, 1, 2];
trace("array", ar, ar.length, ar.join("-"), ar.concat([4], 5), ar.slice(1), ar.slice(-2, -1), ar.indexOf(1), ar.lastIndexOf(9), ar.toString());
trace(ar.push(9), ar.pop(), ar.unshift(0), ar.shift(), ar.reverse(), ar.reverse());
trace(ar.splice(1, 1), ar, ar.splice(1, 0, 7, 8), ar);
trace(new Array(3), new Array(3).length, new Array(1, 2), new Array("3").length, [, ,].length, [1, , 3], [null, undefined]);
var big:Array = []; big[5] = 1; trace(big.length, big); big.length = 2; trace(big);
trace([10, 9, 1].sort(), [10, 9, 1].sort(Array.NUMERIC), [10, 9, 1].sort(Array.NUMERIC | Array.DESCENDING), ["b", "A", "c"].sort(), ["b", "A", "c"].sort(Array.CASEINSENSITIVE), [1, 2, 3].sort(function (a:int, b:int):int { return b - a; }), ["a", "b"].sort(Array.DESCENDING));
trace([{n: 2}, {n: 1}].sortOn("n")[0].n, [{n: "b"}, {n: "a"}].sortOn("n", Array.DESCENDING)[0].n, [{n: 10}, {n: 9}].sortOn("n", Array.NUMERIC)[0].n, [1, 1].sort(Array.UNIQUESORT), [3, 1].sort(Array.RETURNINDEXEDARRAY));
trace([1, 2, 3].every(function (x:*, i:int, a:Array):Boolean { return x > 0; }), [1, 2].some(function (x:*, i:int, a:Array):Boolean { return x > 1; }), [1, 2].filter(function (x:*, i:int, a:Array):Boolean { return x > 1; }), [1, 2].map(function (x:*, i:int, a:Array):* { return x * 2; }));
var fe:int = 0; var two:Array = [1, 2]; two.forEach(function (x:*, i:int, a:Array):void { fe += x; }); trace(fe);
for (var ki:String in [5, 6]) trace(ki, typeof ki);
for each (var vv:* in [5, "x", null]) trace(vv);
var dyn:Array = [1]; dyn.extra = 2; var cnt:int = 0; for (var k2:String in dyn) cnt++; trace(cnt, dyn.length, dyn.extra);

// ---- vectors
var v:Vector.<int> = new Vector.<int>(); v.push(1.9); v.push(2); trace("vector", v, v.length, v[0], v.indexOf(2), v.join("+"), v.fixed, v is Vector.<int>);
var vc:Vector.<String> = new <String>["a", "b"]; vc[1] = "c"; trace(vc, vc.reverse(), vc.slice(1), vc.concat(new <String>["z"]));
var fx:Vector.<int> = new Vector.<int>(2, true); trace(fx, fx.length, fx.fixed, new Vector.<Number>(1), new Vector.<String>(1), new Vector.<Boolean>(1), new Vector.<Object>(1));
try { fx.push(1); } catch (e:Error) { trace(e.errorID, e.name); }
try { fx[5] = 1; } catch (e:Error) { trace(e.errorID, e.name); }
try { v[9]; } catch (e:Error) { trace(e.errorID, e.name); }
var fromA:Vector.<Number> = Vector.<Number>([1, 2.5]); trace(fromA, fromA.length);
var nested:Vector.<Vector.<int>> = new Vector.<Vector.<int>>(); nested.push(new <int>[1]); trace(nested[0][0], nested.length);

// ---- strings
var st:String = "Hello, World";
trace("string", st.length, st.charAt(1), st.charAt(99), st.charCodeAt(0), st.indexOf("o"), st.indexOf("o", 5), st.lastIndexOf("o"), st.substr(7), st.substr(7, 2), st.substr(-3), st.substring(3, 1), st.slice(3, -3), st.toUpperCase(), st.toLowerCase());
trace(st.split(", "), st.split(""). length, "a1b".split(/\d/), st.replace("o", "0"), st.replace(/o/g, "0"), st.replace(/(H)(e)/, "$2$1"), st.search("W"), st.match(/l+/)[0], st.match(/l/g).length, "ab".concat("c", 1));
trace("  x ".length, "a" < "b", "a" == "a", String.fromCharCode(72, 105), "%20".length, "é".length, "é".charCodeAt(0));
trace("x".localeCompare("y"), "x".localeCompare("x"), "abc".valueOf(), new String("s") + "t", (new String("s")).length, typeof new String("s"), typeof String("s"));

// ---- numbers and Math
trace("format", (3.14159).toFixed(2), (1000).toString(), (255).toString(2), (0.5).toString(), (12345.678).toPrecision(3), (0.00001).toExponential(1), Number(5).toFixed(), (5).valueOf());
trace(parseInt("10"), parseInt("10", 2), parseInt("0x10"), parseInt("abc"), parseInt(""), parseInt("12.9"), parseFloat("3.5e2"), parseFloat(".5"), parseFloat("x"), isNaN("x"), isNaN("1"), isFinite("1"), isFinite(NaN));
trace("math", Math.PI, Math.E, Math.SQRT2, Math.abs(-2), Math.ceil(1.1), Math.floor(-1.1), Math.round(1.5), Math.round(-1.5), Math.round(2.5), Math.max(1, 2, 3), Math.min(1, 2), Math.max(), Math.min(), Math.pow(2, 10), Math.sqrt(16), Math.atan2(1, 1), Math.sin(0), Math.cos(0), Math.log(1), Math.exp(0), Math.tan(0), Math.asin(0), Math.acos(1), Math.atan(0));

// ---- functions
function outerFn():Function { var n:int = 0; return function ():int { return ++n; }; }
var cf:Function = outerFn(); cf(); trace("closure", cf(), outerFn()());
var fns:Array = []; for (var li:int = 0; li < 3; li++) fns.push(function ():int { return li; }); trace(fns[0](), fns[2]());
function argsFn(...a):int { return a.length; } function argsFn2():int { return arguments.length; } trace(argsFn(), argsFn(1, 2), argsFn2());
trace(outerFn.length, typed.length, argsFn.length, (function (a:int, b:int):void {}).length);
function thisFn():* { return this; } trace(thisFn() == this, thisFn.call({n: 1}) == this, thisFn.apply(null) == this);
var callee:Function = function (a:int, b:int):int { return a + b; }; trace(callee.call(null, 1, 2), callee.apply(null, [3, 4]));
function fact(n:int):int { return n <= 1 ? 1 : n * fact(n - 1); } trace(fact(10), fact(13));
function later():String { return early(); } function early():String { return "hoisted"; } trace(later());
var hoist:int = useBefore; var useBefore:int = 5; trace(hoist, useBefore);

// ---- control flow
outer: for (var i1:int = 0; i1 < 3; i1++) { for (var i2:int = 0; i2 < 3; i2++) { if (i2 == 1) continue outer; if (i1 == 2) break outer; trace("loop", i1, i2); } }
var w1:int = 0; while (true) { if (++w1 > 2) break; } do { w1--; } while (w1 > 0); trace(w1);
function sw(x:*):String { switch (x) { case 1: return "one"; case "1": return "text"; case null: return "null"; default: return "other"; } } trace(sw(1), sw("1"), sw(null), sw(2), sw(undefined));
var fall:Array = []; switch (2) { case 1: fall.push(1); case 2: fall.push(2); case 3: fall.push(3); break; case 4: fall.push(4); } trace(fall);
function tryIt():String { try { return "try"; } finally { trace("finally"); } } trace(tryIt());
function nest():String { try { try { throw new Error("a"); } catch (e:ArgumentError) { return "no"; } finally { trace("inner"); } } catch (e:Error) { return e.message; } return "x"; } trace(nest());
try { throw "text"; } catch (e:String) { trace("caught", e); } catch (e:*) { trace("other"); }
try { throw 5; } catch (e:String) { trace("no"); } catch (e:int) { trace("number", e); }
try { throw {a: 1}; } catch (e:Object) { trace(e.a); }
try { throw new RangeError("r"); } catch (e:TypeError) { trace("no"); } catch (e:RangeError) { trace(e.name, e.message, e is Error, e.toString(), e.errorID); }
var er:Error = new Error("m", 5); trace(er.message, er.errorID, er.name, er.toString(), er);

// ---- objects
var ob:Object = new Object(); ob.x = 1; ob["y z"] = 2; var keys:Array = []; for (var kk:String in ob) keys.push(kk); keys.sort(); trace(keys);
for each (var vl:* in {only: 7}) trace(vl);
trace({}.toString(), [].toString(), (function ():void {}).toString != null, new Object() is Object, Object(5) is Number, ({a: 1}).a);
var ctor:Object = new Array(); trace(ctor.constructor == Array, (5).constructor == Number, "s".constructor == String);
var Ctor:Function = function (n:int):void { this.n = n; }; Ctor.prototype.twice = function ():int { return this.n * 2; }; var made:* = new Ctor(4); trace(made.n, made.twice());
var dt:Date = new Date(2000, 1, 29); dt.date += 1; trace(dt.month, dt.date, dt.getDay(), new Date(2000, 0, 1).getTimezoneOffset() == new Date(2000, 0, 1).timezoneOffset, Date.UTC(2000, 0, 1));
trace(new Date(0).fullYearUTC, new Date(0).hoursUTC);
var bits:Array = [1]; bits.toString = function ():String { return "custom"; }; trace(bits, "" + bits);
trace(flash.utils.getQualifiedClassName(1.5), getTimer() >= 0, typeof getTimer());
trace(/a/.test("cat"), /(\d+)-(\d+)/.exec("10-20").length, /a/g.global, /a/i.ignoreCase, /a/m.multiline, /a/s.dotall, /a/x.extended, /a/.lastIndex);
trace(escape("a+b c/d"), unescape("%41"), encodeURI("a b&c"), encodeURIComponent("a b&c"), decodeURI("%20"));
trace(undefined, null, NaN, Infinity, -Infinity, true, false);
trace();
trace("");
trace("a", "", "b");
// Error called as a function; for each over an array changed in the loop; a Vector's index
// with a side effect in a compound assignment, a Vector made longer; the key of a for..in
var boom:Error = new Error("boom");
var asCall:* = Error(boom);
trace("error call", asCall === boom, asCall is Error, asCall.message);
var each:Array = [1, 2, 3, 4];
var seenEach:Array = [];
for each (var en:int in each) {
	seenEach.push(en);
	if (en == 2) each.splice(2, 1);
}
trace("each spliced", seenEach.join(","), each.join(","));
var grown:Vector.<int> = new Vector.<int>();
grown.push(1, 2, 3);
var gi:int = 0;
grown[gi++] += 10;
trace("vector compound", grown.join(","), gi);
grown.length = 5;
trace("vector longer", grown.join(","), grown.length, grown[4] === 0);
var named:Vector.<String> = new Vector.<String>(2);
trace("vector strings", named[0] === null, named.length);
for (var untyped:* in ["x", "y"]) trace("array key", untyped, typeof untyped, untyped + 1);
// a Dictionary with objects as keys: written with = += ++, keys after a delete, `in`
var dict:Dictionary = new Dictionary();
var keyA:Object = {n: 1};
var keyB:Sprite = new Sprite();
dict[keyA] = 5;
dict[keyA] += 1;
dict[keyB] = 1;
dict[keyB]++;
dict["s"] = "t";
var dictCount:int = 0;
for (var dictKey:* in dict) dictCount++;
delete dict[keyA];
var dictLeft:Array = [];
for (var dictKey2:* in dict) dictLeft.push(dictKey2 === keyB ? "sprite" : dictKey2);
dictLeft.sort();
trace("dictionary", dictCount, dictLeft.join(","), keyA in dict, keyB in dict, dict[keyB], dict[keyA]);
trace("END");
fscommand("quit");
