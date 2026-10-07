import {listWards} from '@/lib/wards-api';
export const dynamic='force-dynamic';
export async function GET(){return listWards();}
