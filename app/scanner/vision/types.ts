export type Point={x:number;y:number};
export type Quad=[Point,Point,Point,Point];
export type Presence='full'|'partial'|'absent'|'unknown';
export type MarkerReference={id:string;role:'tl'|'tr'|'br'|'bl';bits:number[];size:number;pageCorners:Quad};
export type SheetTemplate={id:string;version:number;width:number;height:number;markers:MarkerReference[]};
export type Quality={eligible:boolean;score:number;sharpness:number;contrast:number;coverage:number;reasons:string[]};
export type Detection={presence:Presence;pageQuad?:Quad;markers:{id:string;corners:Quad;error:number}[];quality:Quality;homography?:number[];frameId:number;width:number;height:number};
export type Geometry={homography:number[];quad:Quad;templateWidth:number;templateHeight:number;frameWidth:number;frameHeight:number};
export type Analysis={sessionId:string;width:number;height:number;markers:{id:string;corners:Quad;error:number}[];quad:Quad|null;presence:Presence;quality:Quality;bitmap:ImageBitmap;geometry:Geometry|null};

export type QrPayload={raw:string;data:Record<string,unknown>|null;format:'json'|'text'};
export type RectifiedCapture={blob:Blob;qr:QrPayload};
