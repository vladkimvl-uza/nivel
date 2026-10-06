// Source of vendor/three-nivel.min.js (three@0.169.0, MIT). Rebuild after the page starts using a new THREE.* class:
//   npm pack three@0.169.0, then
//   esbuild three-nivel.entry.js --bundle --format=iife --global-name=NV3 --minify --legal-comments=none --outfile=three-nivel.min.js
// The class list = every THREE.<Name> used in ../index.html.
import { BackSide,Box2,BoxGeometry,BufferGeometry,CanvasTexture,Color,DirectionalLight,DoubleSide,ExtrudeGeometry,Float32BufferAttribute,FrontSide,Group,HemisphereLight,LineBasicMaterial,LineSegments,Mesh,MeshBasicMaterial,MeshPhysicalMaterial,MeshStandardMaterial,NoToneMapping,PCFShadowMap,PMREMGenerator,Path,PerspectiveCamera,PlaneGeometry,RepeatWrapping,SRGBColorSpace,Scene,ShadowMaterial,Shape,SpotLight,Vector2,Vector3,Vector4,WebGLRenderer } from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
const THREE = { BackSide,Box2,BoxGeometry,BufferGeometry,CanvasTexture,Color,DirectionalLight,DoubleSide,ExtrudeGeometry,Float32BufferAttribute,FrontSide,Group,HemisphereLight,LineBasicMaterial,LineSegments,Mesh,MeshBasicMaterial,MeshPhysicalMaterial,MeshStandardMaterial,NoToneMapping,PCFShadowMap,PMREMGenerator,Path,PerspectiveCamera,PlaneGeometry,RepeatWrapping,SRGBColorSpace,Scene,ShadowMaterial,Shape,SpotLight,Vector2,Vector3,Vector4,WebGLRenderer };
export { THREE, SVGLoader, Line2, LineSegments2, LineGeometry, LineSegmentsGeometry, LineMaterial, RoomEnvironment };
