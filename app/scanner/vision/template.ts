import reference from './reference.json';
import type { SheetTemplate } from './types';
export function validateTemplate(value:unknown):SheetTemplate {
 const t=value as SheetTemplate;if(!t||typeof t.id!=='string'||!Number.isFinite(t.width)||!Number.isFinite(t.height)||t.width<=0||t.height<=0||t.width>10000||t.height>10000||!Array.isArray(t.markers)||t.markers.length!==4)throw Error('Некорректный шаблон страницы');
 const ids=new Set<string>(),roles=new Set<string>();
 for(const m of t.markers){if(!m||typeof m.id!=='string'||ids.has(m.id)||!['tl','tr','br','bl'].includes(m.role)||roles.has(m.role)||!Number.isInteger(m.size)||m.size<4||m.size>16||!Array.isArray(m.bits)||m.bits.length!==m.size*m.size||m.bits.some(v=>v!==0&&v!==1)||!Array.isArray(m.pageCorners)||m.pageCorners.length!==4||m.pageCorners.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>t.width||p.y>t.height))throw Error('Некорректные маркеры шаблона');ids.add(m.id);roles.add(m.role);}
 return t;
}
export const REFERENCE_TEMPLATE=validateTemplate(reference);
