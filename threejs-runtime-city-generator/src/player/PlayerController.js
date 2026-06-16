// Turns input into motion. Movement is built from the active camera's yaw so
// "W" always goes where the camera faces. The player is kept grounded by
// sampling terrain height every frame; jumping uses a small gravity model and
// always lands back on the terrain surface.

import * as THREE from "three";
import { getHeight } from "../terrain/terrainSampling.js";
import { damp, dampAngle } from "../utils/math.js";

export class PlayerController {
  constructor(player, input, cameraController) {
    this.player = player;
    this.input = input;
    this.cam = cameraController;

    this.walkSpeed = 8.5;
    this.sprintSpeed = 15;
    this.accel = 13; // horizontal velocity smoothing rate
    this.jumpSpeed = 8.5;
    this.gravity = 26;
    this.turnRate = 13; // how fast the mesh rotates to face movement

    this._vel = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._desired = new THREE.Vector3();

    // Position the player on the ground at spawn.
    const p = this.player.position;
    p.y = getHeight(p.x, p.z);
    this.player.syncMesh();
  }

  update(dt) {
    const { input, player } = this;
    const yaw = this.cam.yaw;

    // Horizontal basis from the camera yaw (three.js forward = -Z at yaw 0).
    this._forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this._right.set(Math.cos(yaw), 0, -Math.sin(yaw));

    const { forward, strafe } = input.getMoveAxis();
    this._desired
      .set(0, 0, 0)
      .addScaledVector(this._forward, forward)
      .addScaledVector(this._right, strafe);

    const moving = this._desired.lengthSq() > 1e-5;
    if (moving) this._desired.normalize();

    const sprint = input.isDown("ShiftLeft") || input.isDown("ShiftRight");
    const speed = moving ? (sprint ? this.sprintSpeed : this.walkSpeed) : 0;

    // Smoothly accelerate horizontal velocity toward the target.
    const tx = this._desired.x * speed;
    const tz = this._desired.z * speed;
    this._vel.x = damp(this._vel.x, tx, this.accel, dt);
    this._vel.z = damp(this._vel.z, tz, this.accel, dt);

    player.position.x += this._vel.x * dt;
    player.position.z += this._vel.z * dt;

    // Vertical: jump + gravity, clamped to the terrain.
    const groundY = getHeight(player.position.x, player.position.z);
    if (player.grounded && input.wasPressed("Space")) {
      player.velocityY = this.jumpSpeed;
      player.grounded = false;
    }
    player.velocityY -= this.gravity * dt;
    player.position.y += player.velocityY * dt;

    if (player.position.y <= groundY) {
      player.position.y = groundY;
      player.velocityY = 0;
      player.grounded = true;
    } else {
      player.grounded = false;
    }

    // Facing: in first-person the body aligns to the camera; in third-person it
    // turns to face the movement direction.
    if (this.cam.mode === "first") {
      player.facing = yaw + Math.PI; // nose points along camera forward
    } else if (moving && this._vel.lengthSq() > 0.4) {
      const targetFacing = Math.atan2(this._vel.x, this._vel.z);
      player.facing = dampAngle(player.facing, targetFacing, this.turnRate, dt);
    }

    player.syncMesh();
  }

  get speed() {
    return Math.hypot(this._vel.x, this._vel.z);
  }
}
