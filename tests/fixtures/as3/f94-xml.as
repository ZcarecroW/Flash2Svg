import flash.events.Event;
import flash.net.URLLoader;
import flash.net.URLRequest;
import flash.system.fscommand;

// XML and E4X: literals, children, attributes, descendants, filters, changes, text in and out
var shop:XML = <shop name="Corner" open="yes">
	<!-- a comment -->
	<item id="1" kind="fruit"><name>Apple</name><price>1.5</price></item>
	<item id="2" kind="fruit"><name>Pear</name><price>2</price></item>
	<item id="3" kind="tool"><name>Saw</name><price>12.25</price><tag>sharp</tag></item>
	<note>Open <b>daily</b> &amp; late</note>
</shop>;

trace("name", shop.name(), shop.@name, shop.@open == "yes", shop.attributes().length(), typeof shop, shop is XML, shop.item is XMLList);
trace("items", shop.item.length(), shop.item[0].name, shop.item[1].@id, shop.item.name.length());
trace("text", shop.item[0].name.text(), shop.item[2].tag, shop.note.text(), shop.note.b);
trace("filter", shop.item.(@kind == "fruit").length(), shop.item.(price > 2).name, shop.item.(@id == "2").price, shop.item.(name == "Pear").@id);
trace("desc", shop..name.length(), shop..price.length(), shop..@id.length(), shop..@id[2]);
var total:Number = 0;
for each (var it:XML in shop.item) total += Number(it.price);
trace("total", total);
var ids:Array = [];
for each (var a:XML in shop.item.@id) ids.push(String(a));
trace("ids", ids.join());
trace("index", shop.item[2].childIndex(), shop.item[2].parent().name(), shop.item[1].@kind.parent().@id);
trace("string", String(shop.item[0].price), shop.item[0].price + 1, Number(shop.item[0].price) + 1, shop.item[0].price == 1.5);
trace("kinds", shop.item[0].nodeKind(), shop.item[0].@id[0].nodeKind(), shop.note.children().length(), shop.note.hasComplexContent(), shop.item[0].name.hasSimpleContent());
trace(shop.item[0].toXMLString());
trace(shop.item[0]);
trace(shop.item.name);
trace(shop.note.toXMLString());
trace(shop.note);

// changing it
shop.item[0].@id = "10";
shop.item[0].price = 1.75;
shop.item[1].appendChild(<tag>soft</tag>);
shop.appendChild(<item id="4"><name>Nail</name></item>);
delete shop.item[2];
shop.@open = "no";
trace("changed", shop.item.length(), shop.item[0].@id, shop.item[0].price, shop.item[1].tag, shop.item[2].name, shop.@open);
shop.item[0].name = "Green apple";
shop.item[0].@sale = "yes";
trace(shop.item[0].toXMLString());
shop.item[1].prependChild(<first/>);
trace("prepended", shop.item[1].children()[0].name(), shop.item[1].children().length());

// from text
var nums:XML = new XML("<list><v>1</v><v>2</v><v>3</v></list>");
trace("parsed", nums.v.length(), nums.v[1], nums.children().length());
trace(nums.toXMLString());
var empty:XML = new XML("");
trace("empty", empty.toXMLString() == "", empty.nodeKind());
var spaced:XML = new XML("<a>  <b> hi </b>  </a>");
trace("spaced", "[" + spaced.b + "]", "[" + spaced.b.text() + "]", spaced.children().length());
var list:XMLList = new XMLList("<p>1</p><p>2</p>");
trace("list", list.length(), list[1], list.toXMLString().split("\n").join("|"));
var lit:XMLList = <><a>1</a><b>2</b></>;
trace("literal list", lit.length(), lit[0].name(), lit[1]);
var k:String = "kind";
var v:int = 7;
var built:XML = <node {k}="tool" n={v * 2}>{"x" + v}<inner>{v}</inner></node>;
trace(built.toXMLString());
trace("copy", shop.item[0].copy() == shop.item[0], shop.item[0].copy() === shop.item[0], shop.item[0].copy().parent() == null);
try {
	new XML("<a><b></a>");
} catch (e:Error) {
	trace("error", e.errorID, e is TypeError);
}
trace("elements", shop.elements().length(), shop.children().length(), shop.elements("item").length(), shop.child("note").length(), shop.descendants("price").length());
trace("has", shop.hasOwnProperty("item"), shop.hasOwnProperty("nothing"), shop.item.@kind.length(), shop.nothing.length());
trace("escape", <t a={"<&\">"}>{"1 < 2 & 3"}</t>.toXMLString());
XML.prettyPrinting = false;
trace(shop.item[0].toXMLString());
// an item of a list given a value, not XML: does it keep its name?
var d:XML = <r><c>1</c><c>2</c><s><v>x</v></s></r>;
d.c[0] = "4";
d..v[0] = "A";
trace("put", d.toXMLString());
// adding XML to XML: a list of both
var joined:XMLList = <><a>1</a></>;
joined += <b>2</b>;
trace("add", joined.length(), joined[1].name(), (d.c[1] + d.c[0]).length(), d.c[1] + "-");
var sum:XMLList = d.c + d.s;
trace("plus", sum.length(), sum[2].name());
// the keys of a list
var keys:Array = [];
for (var key:String in d.c) keys.push(key);
trace("keys", keys.join(","));
// ++ on an attribute
var counter:XML = <c n="1"/>;
counter.@n++;
trace("attr++", counter.@n, counter.toXMLString());
XML.prettyPrinting = true;

// XML from a file
var loader:URLLoader = new URLLoader();
loader.addEventListener(Event.COMPLETE, function (e:Event):void {
	var feed:XML = new XML(loader.data);
	trace("loaded", feed.name(), feed.entry.length(), feed.entry[1].@title, feed..tag.length(), feed.entry.(tag == "a").@title);
	for each (var en:XML in feed.entry) trace("entry", en.@title, en.tag.length(), en.tag.toString());
	trace("END");
	fscommand("quit");
});
loader.load(new URLRequest("data.xml"));
