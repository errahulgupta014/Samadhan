import {redirect} from 'next/navigation';
/** The administrator portal now lives at the site root (test.smadhan.com/); this old address just forwards there. */
export default function Admin(){redirect('/');}
