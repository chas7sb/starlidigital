export default class RFB extends EventTarget {
 constructor(target:HTMLElement,url:string,options?:{shared?:boolean;wsProtocols?:string[]});
 viewOnly:boolean;focusOnClick:boolean;scaleViewport:boolean;resizeSession:boolean;
 focus():void;blur():void;disconnect():void;
}
