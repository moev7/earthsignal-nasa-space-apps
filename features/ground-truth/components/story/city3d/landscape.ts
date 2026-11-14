/** Illustrative canopy positions, strictly inside the supplied mapped park polygons. */
import * as THREE from 'three'
import type { Bounds, Street } from './ambient'
import { disposeTree, makeRng } from './shared'

export function parkCanopies(parent: THREE.Group, streets: Street[], bounds: Bounds, ground: (x: number, z: number) => number) {
  const rnd = makeRng(43)
  const positions: { x: number; z: number; size: number }[] = []
  const contains = (ring: [number, number][], x: number, z: number) => {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, ni] = ring[i]; const [xj, nj] = ring[j]
      const zi = -ni; const zj = -nj
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside
    }
    return inside
  }
  for (const park of streets.filter(street => street.kind === 'green' && street.line.length >= 3)) {
    const minX = Math.max(bounds.minX + 5, Math.min(...park.line.map(p => p[0])))
    const maxX = Math.min(bounds.maxX - 5, Math.max(...park.line.map(p => p[0])))
    const minZ = Math.max(bounds.minZ + 5, Math.min(...park.line.map(p => -p[1])))
    const maxZ = Math.min(bounds.maxZ - 5, Math.max(...park.line.map(p => -p[1])))
    if (maxX <= minX || maxZ <= minZ) continue
    const count = Math.min(32, Math.ceil((maxX - minX) * (maxZ - minZ) / 130))
    for (let attempt = 0, found = 0; attempt < count * 12 && found < count && positions.length < 96; attempt++) {
      const x = minX + rnd() * (maxX - minX); const z = minZ + rnd() * (maxZ - minZ)
      if (!contains(park.line, x, z)) continue
      positions.push({ x, z, size: 0.8 + rnd() * 0.7 }); found++
    }
  }
  const root = new THREE.Group()
  root.name = 'illustrative-canopies-in-mapped-parks'
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.6, 4, 5), new THREE.MeshStandardMaterial({ color: '#66503b', roughness: 1 }), positions.length)
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(4, 1), new THREE.MeshStandardMaterial({ color: '#65845c', roughness: 1, flatShading: true }), positions.length)
  trunks.castShadow = crowns.castShadow = true
  crowns.receiveShadow = true
  const transform = new THREE.Object3D()
  const colour = new THREE.Color()
  positions.forEach((_, i) => crowns.setColorAt(i, colour.setHSL(0.25 + rnd() * 0.06, 0.22, 0.26 + rnd() * 0.12)))
  root.add(trunks, crowns); parent.add(root)
  function refresh() {
    positions.forEach(({ x, z, size }, i) => {
      const y = ground(x, z)
      transform.position.set(x, y + 2 * size, z); transform.scale.setScalar(size); transform.updateMatrix(); trunks.setMatrixAt(i, transform.matrix)
      transform.position.y = y + 5.5 * size; transform.scale.set(size, size * 0.9, size); transform.updateMatrix(); crowns.setMatrixAt(i, transform.matrix)
    })
    trunks.instanceMatrix.needsUpdate = crowns.instanceMatrix.needsUpdate = true
    trunks.computeBoundingSphere(); crowns.computeBoundingSphere()
  }
  refresh()
  return { refresh, dispose() { parent.remove(root); disposeTree(root); trunks.dispose(); crowns.dispose() } }
}
