import fs from 'node:fs';
function change(file,updates){let source=fs.readFileSync(file,'utf8');for(const [before,after] of updates){if(!source.includes(before))throw new Error(`Missing replacement in ${file}: ${before.slice(0,65)}`);source=source.replace(before,after);}fs.writeFileSync(file,source);}
change('shared/domain.ts',[["return { complaints: specs.map", "return { categories: defaultIssueCategories(), complaints: specs.map"]]);
change('lib/service.ts',[["category:body.category,locality:","categoryId:category.id,category:category.nameEn,locality:"]]);
let route=fs.readFileSync('app/api/workspace/route.ts','utf8');route=route.replace("import { seedWorkspace } from '@/shared/domain';","import { loadWorkspace as load } from '@/lib/workspaces';");route=route.replace(/^async function load\(owner:string\).*\r?\n/m,'');fs.writeFileSync('app/api/workspace/route.ts',route);
change('app/admin-panels.tsx',[
 ["import {categories,teams,transitions,type Complaint,type Workspace}","import {teams,transitions,type Complaint,type Workspace,type IssueCategory}"],
 ["type Act=","import CategoryManager from './category-manager';\ntype Act="],
 ["{complaint:c,onClose,act,busy}:{complaint:Complaint|null;", "{complaint:c,onClose,act,busy,categories}:{categories:IssueCategory[];complaint:Complaint|null;"],
 ["options={categories} onChange={v=>void run({action:'edit',category:v})}","options={Array.from(new Set([c.category,...categories.filter(x=>x.enabled).map(x=>x.nameEn)]))} onChange={v=>void run({action:'edit',categoryId:categories.find(x=>x.nameEn===v)?.id})}"],
 ["{page==='Settings'&&<div className=\"settings-grid\">", "{page==='Settings'&&<><CategoryManager categories={data.categories} busy={busy} act={act}/><div className=\"settings-grid\">"],
 ["</div></div></div>}\n </section>","</div></div></div></>}\n </section>"],
]);
change('app/portal.tsx',[
 ["statuses, categories, type Complaint", "statuses, type Complaint"],
 ["options={['All categories',...categories]}","options={['All categories',...Array.from(new Set([...data.categories.map(c=>c.nameEn),...complaints.map(c=>c.category)]))]}"],
 ["<ComplaintDetail complaint=","<ComplaintDetail categories={data.categories} complaint="],
]);
change('mobile/src/ReportFlow.tsx',[
 ["import {categories} from '../shared/domain';","import {useCategories} from './useCategories';"],
 ["const icons=['walk-outline','trash-outline','water-outline','bulb-outline','water','leaf-outline','business-outline','ellipsis-horizontal'] as const;\nconst hindiCategories=['सड़क / फुटपाथ','कचरा / सफाई','नाली / सीवर','स्ट्रीट लाइट','पानी','पार्क / सार्वजनिक स्थान','सार्वजनिक संरचना','अन्य'];", "const safeIcon=(icon:string):React.ComponentProps<typeof Ionicons>['name']=>icon in Ionicons.glyphMap?icon as React.ComponentProps<typeof Ionicons>['name']:'ellipsis-horizontal';"],
 [" async function run", " const catalog=useCategories(connection);const categories=catalog.categories;const selectedCategory=categories.find(c=>c.id===category);\n async function run"],
 ["if(step===0&&!category)","if(step===0&&!selectedCategory)"],
 ["{step===0&&<View style={s.grid}>{categories.map((cat,i)=><Pressable key={cat} accessibilityRole=\"radio\" accessibilityState={{checked:category===cat}} onPress={()=>setCategory(cat)} style={[s.category,category===cat&&s.selectedCategory]}><Ionicons name={icons[i]} size={29} color={category===cat?'#09724e':['#2473a0','#ed9336','#4491b0','#dfa43e','#3a88b6','#318d60','#547a99','#698194'][i]}/><Text style={[s.categoryName,category===cat&&{color:'#086b4a'}]}>{hindi?hindiCategories[i]:cat}</Text>{category===cat&&<Ionicons style={s.categoryCheck} name=\"checkmark-circle\" size={17} color=\"#148257\"/>}</Pressable>)}</View>}",
 "{step===0&&<><View style={s.catalogBar}><Text style={s.small}>{catalog.loading?t('Loading issue types…','समस्या के प्रकार लोड हो रहे हैं…'):t('Available in your ward','आपके वार्ड में उपलब्ध')}</Text><Pressable accessibilityRole=\"button\" disabled={catalog.loading} onPress={()=>void catalog.refresh()}><Text style={s.change}>{t('Refresh','रिफ्रेश करें')}</Text></Pressable></View>{catalog.error?<Text accessibilityRole=\"alert\" style={s.error}>{catalog.error}</Text>:!catalog.loading&&!categories.length?<Text style={s.copy}>{t('No issue types are currently available. Please contact your ward office.','अभी कोई श्रेणी उपलब्ध नहीं है। वार्ड कार्यालय से संपर्क करें।')}</Text>:<View style={s.grid}>{categories.map(cat=><Pressable key={cat.id} accessibilityRole=\"radio\" accessibilityState={{checked:category===cat.id}} onPress={()=>setCategory(cat.id)} style={[s.category,category===cat.id&&s.selectedCategory]}><Ionicons name={safeIcon(cat.icon)} size={29} color={category===cat.id?'#09724e':cat.color}/><Text style={[s.categoryName,category===cat.id&&{color:'#086b4a'}]}>{hindi?cat.nameHi:cat.nameEn}</Text>{category===cat.id&&<Ionicons style={s.categoryCheck} name=\"checkmark-circle\" size={17} color=\"#148257\"/>}</Pressable>)}</View>}</>}"],
 ["name={icons[categories.indexOf(category)]}","name={safeIcon(selectedCategory?.icon||'ellipsis-horizontal')}"],
 ["{hindi?hindiCategories[categories.indexOf(category)]:category}","{selectedCategory?(hindi?selectedCategory.nameHi:selectedCategory.nameEn):t('Category unavailable','श्रेणी उपलब्ध नहीं है')}"],
 ["{action:'create',category,title", "{action:'create',categoryId:category,title"],
 ["<Action busy={busy} title={busy?", "<Action busy={busy||(step===0&&(catalog.loading||!!catalog.error||!categories.length))} title={busy?"],
 ["StyleSheet.create({progress:", "StyleSheet.create({catalogBar:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:16},progress:"],
]);
