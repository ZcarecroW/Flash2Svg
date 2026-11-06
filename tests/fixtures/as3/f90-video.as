import fl.video.*;
import flash.events.*;
import flash.system.fscommand;

function r(n:Number):Number { return Math.round(n * 10) / 10; }
function say(e:Event):void {
	trace(e.type, vid.state, vid.playing, vid.paused, vid.stopped);
}
trace(vid is FLVPlayback, vid.source, vid.autoPlay, vid.autoRewind, vid.paused, vid.playing, vid.stopped, vid.state, vid.playheadTime, vid.volume, r(vid.width), vid.height, vid.scaleMode, vid.isLive, vid.bufferTime);
trace(VideoEvent.COMPLETE, VideoEvent.READY, VideoEvent.SEEKED, VideoEvent.STATE_CHANGE, VideoEvent.PLAYHEAD_UPDATE, VideoEvent.PAUSED_STATE_ENTERED, VideoEvent.PLAYING_STATE_ENTERED, VideoEvent.STOPPED_STATE_ENTERED, VideoEvent.AUTO_REWOUND, VideoEvent.BUFFERING_STATE_ENTERED, VideoEvent.CLOSE);
trace(MetadataEvent.CUE_POINT, MetadataEvent.METADATA_RECEIVED, VideoState.PLAYING, VideoState.PAUSED, VideoState.STOPPED, VideoState.BUFFERING, VideoState.LOADING, VideoState.SEEKING, VideoState.REWINDING, VideoState.DISCONNECTED, VideoState.CONNECTION_ERROR, VideoScaleMode.MAINTAIN_ASPECT_RATIO, VideoScaleMode.NO_SCALE, VideoScaleMode.EXACT_FIT, CuePointType.ALL, CuePointType.EVENT, CuePointType.NAVIGATION, CuePointType.FLV, CuePointType.ACTIONSCRIPT);

// ---- cue points
var a:Object = vid.addASCuePoint(0.5, "half");
var b:Object = vid.addASCuePoint({time: 1, name: "one", parameters: {kind: "test"}});
trace(a.name, a.time, a.type, a.array.length, a.index, b.name, b.time, b.parameters.kind);
var c:Object = vid.findCuePoint("half");
trace(c.name, c.time, c.type, c.index);
c = vid.findCuePoint(1); trace(c.name);
c = vid.findCuePoint("nothing"); trace(c);
c = vid.findNearestCuePoint(0.8); trace(c.name);
c = vid.findNearestCuePoint("one"); trace(c.name);
c = vid.findNextCuePointWithName(vid.findCuePoint("half")); trace(c);

// ---- events, while it plays once
var times:Array = [];
vid.addEventListener(MetadataEvent.CUE_POINT, function (e:MetadataEvent):void {
	trace("cue", e.info.name, e.info.time, e.info.type, e.type, e.bubbles);
});
vid.addEventListener(VideoEvent.COMPLETE, function (e:Object):void {
	trace("complete", vid.state, r(e.playheadTime), r(vid.totalTime), r(vid.playheadTime));
	vid.seek(1);
});
vid.addEventListener(VideoEvent.SEEKED, function (e:Object):void {
	trace("seeked", vid.state);
	trace("END");
	fscommand("quit");
});
vid.addEventListener(VideoEvent.READY, function (e:Object):void {
	trace("ready", vid.state, r(vid.totalTime), vid.metadata != null);
	vid.play();
});
vid.addEventListener(VideoEvent.PAUSED_STATE_ENTERED, say);
vid.addEventListener(VideoEvent.PLAYING_STATE_ENTERED, say);
vid.addEventListener(VideoEvent.STOPPED_STATE_ENTERED, say);
stop();
