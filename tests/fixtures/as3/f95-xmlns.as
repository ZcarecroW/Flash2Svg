import flash.system.fscommand;

// XML namespaces: an Atom feed with Media RSS, qualified names, the default namespace, QName
var atom:Namespace = new Namespace("http://www.w3.org/2005/Atom");
var media:Namespace = new Namespace("media", "http://search.yahoo.com/mrss/");
var feed:XML = <feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" lang="en">
	<title>News</title>
	<entry id="1"><title>First</title><media:thumbnail url="a.png" media:w="10"/></entry>
	<entry id="2"><title>Second</title></entry>
</feed>;
trace("plain", feed.entry.length(), feed.title.length(), feed.name(), feed.name().localName, feed.name().uri, feed.localName());
trace("qualified", feed.atom::entry.length(), feed.atom::entry[1].atom::title, feed.atom::entry[0].media::thumbnail.@url, feed.atom::entry[0].media::thumbnail.@media::w);
trace("descendants", feed..atom::title.length(), feed..media::thumbnail.length(), feed..title.length(), feed.atom::*.length());
trace("ns", feed.namespace(), feed.namespace("media"), feed.namespace().prefix == "", feed.namespace("media").prefix, feed.inScopeNamespaces().length, feed.namespaceDeclarations().length);
trace("attr", feed.@lang, feed.attributes().length(), feed.atom::entry[0].@id, feed.atom::entry[0].media::thumbnail.attributes().length());
trace("names", feed.atom::entry[0].media::thumbnail.name(), feed.atom::entry[0].media::thumbnail.localName(), feed.atom::entry[0].media::thumbnail.@media::w.name());
trace(feed.atom::entry[0].toXMLString());
trace(feed.toXMLString());
default xml namespace = atom;
trace("default", feed.entry.length(), feed.entry[0].title, feed..title.length());
var made:XML = <thing><part/></thing>;
trace("made", made.name(), made.part.length(), made.toXMLString());
default xml namespace = new Namespace("");
trace("reset", feed.entry.length(), made.part.length(), made.atom::part.length());
var q:QName = new QName(atom, "entry");
trace("qname", q, q.localName, q.uri, feed.child(q).length(), feed.elements(q).length(), feed.descendants(new QName(atom, "title")).length());
var plainNs:XML = <a xmlns:x="urn:x"><x:b>1</x:b><b>2</b></a>;
var xn:Namespace = plainNs.namespace("x");
trace("prefix", plainNs.b, plainNs.children().length(), plainNs.children()[0].name(), plainNs.children()[0].localName(), plainNs.xn::b, xn.uri, xn.prefix);
var parsed:XML = new XML('<rss xmlns:dc="http://purl.org/dc/elements/1.1/"><item><dc:creator>Ann</dc:creator></item></rss>');
var dc:Namespace = new Namespace("http://purl.org/dc/elements/1.1/");
trace("rss", parsed.item.dc::creator, parsed..dc::creator.length(), parsed.item.creator.length(), String(Namespace("urn:y")), new Namespace("p", "urn:p"));
trace("END");
fscommand("quit");
