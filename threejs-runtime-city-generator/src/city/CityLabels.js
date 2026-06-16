import * as THREE from "three";
import { getZoneStyle } from "./CityConfig.js";
import { getHeight } from "../terrain/terrainSampling.js";

export function createZoneLabelSprite(zone) {
  const style = getZoneStyle(zone.type);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(10, 15, 13, 0.78)";
  roundRect(ctx, 18, 22, 476, 110, 18);
  ctx.fill();
  ctx.strokeStyle = "rgba(127, 220, 160, 0.55)";
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = "#7fdca0";
  ctx.font = "bold 28px ui-monospace, Menlo, Consolas, monospace";
  ctx.fillText(style.label.toUpperCase(), 42, 66);
  ctx.fillStyle = "#d7e6dc";
  ctx.font = "24px ui-monospace, Menlo, Consolas, monospace";
  ctx.fillText(zone.label, 42, 104);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.name = `ZoneLabel_${zone.type}_${zone.id}`;
  sprite.position.set(zone.x, getHeight(zone.x, zone.z) + 22, zone.z);
  sprite.scale.set(26, 8.125, 1);
  sprite.userData.dispose = () => {
    texture.dispose();
    material.dispose();
  };
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
