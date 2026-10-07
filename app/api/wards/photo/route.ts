import {wardPhoto} from '@/lib/wards-api';
export const dynamic='force-dynamic';
export async function GET(request:Request){return wardPhoto(request);}
