// Scenes as scripts see them; the document is exported with "all scenes in a row".
import flash.events.*;
import flash.system.fscommand;
function say(where:String):void {
	trace(where, currentFrame, totalFrames, currentScene.name, currentScene.numFrames, currentScene.labels.length, currentLabel, currentFrameLabel, currentLabels.length);
}
function attempt(f:Function):void { try { f(); trace("no error"); } catch (e:Error) { trace(e.errorID, e.name, e.message); } }
say("first");
trace(scenes.length, scenes[0].name, scenes[1].name, scenes[2].name, scenes[1].numFrames, scenes[2].labels[0].name, scenes[2].labels[0].frame);
attempt(function ():void { gotoAndStop(1, "No such scene"); });
attempt(function ():void { gotoAndStop("nothing"); });
if (this.again) gotoAndPlay("shared"); else gotoAndPlay(2);
