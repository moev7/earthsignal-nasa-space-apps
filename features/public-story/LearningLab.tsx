'use client';
import { AquiferCrossSection } from '@/features/ground-truth/components/story/AquiferCrossSection';
import { BeforeAfterSlider } from '@/features/ground-truth/components/story/BeforeAfterSlider';
import { DeformationProfileChart } from '@/features/ground-truth/components/story/DeformationProfileChart';
import CauseExperiments from './CauseExperiments';
import MissionComparison from './MissionComparison';
import './learning-lab.css';

export default function LearningLab({topic}:{topic:'mechanism'|'radar'}) {
  if(topic==='radar')return <div className="es-learning-lab">
    <details className="es-disclosure"><summary>Compare satellite missions and techniques</summary><div className="es-disclosure-body"><MissionComparison/></div></details>
    <details className="es-disclosure"><summary>Explore the shape of a sinking bowl</summary><div className="es-disclosure-body"><h4>Illustrated deformation profile</h4><DeformationProfileChart/><p>The profile is schematic, shaped to explain a published regional pattern. Hover or touch to inspect the curve; the accessible values are listed below. It is not extracted from the connected NISAR raster.</p><ProfileValues/></div></details>
  </div>;
  return <div className="es-learning-lab">
    <figure><BeforeAfterSlider autoSweep={false} className="es-mechanism-comparison" ariaLabel="Before and after aquifer compaction comparison" beforeLabel="Before sustained pumping" afterLabel="After sustained pumping" before={<AquiferCrossSection compaction={0} waterLevel={0} showLabels={false} showReference={false}/>} after={<AquiferCrossSection compaction={1} waterLevel={1} showLabels={false} showReference/>}/><figcaption>Drag the divider or focus its handle and use the arrow keys. These are conceptual states of the same ground; their geometry and timing are illustrative.</figcaption></figure>
    <CauseExperiments/>
  </div>;
}

import { DEFORMATION_PROFILE } from '@/features/ground-truth/data/tehranStory';
function ProfileValues(){return <details><summary>Read the illustrated profile values</summary><table><thead><tr><th>Distance across the plain (km)</th><th>Illustrated rate (mm/year)</th></tr></thead><tbody>{DEFORMATION_PROFILE.map(point=><tr key={point.distanceKm}><td>{point.distanceKm}</td><td>{point.mmPerYear}</td></tr>)}</tbody></table></details>;}
