import { createClient } from '@supabase/supabase-js'
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
export const supabase = url && key ? createClient(url, key) : null
export async function saveWatchlist(userId:string, marketId:string){ if(!supabase)return; await supabase.from('watchlists').upsert({user_id:userId,market_id:marketId}) }
export async function removeWatchlist(userId:string, marketId:string){ if(!supabase)return; await supabase.from('watchlists').delete().eq('user_id',userId).eq('market_id',marketId) }
