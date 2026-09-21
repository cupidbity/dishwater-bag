-- run once in the supabase sql editor.
--
-- rls is on with no policies, so the publishable key cannot touch the table
-- directly. the two functions below are the only things the browser may call.

create table if not exists public.leaderboard (
  player_id  uuid primary key,
  name       text not null,
  best_score integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.leaderboard enable row level security;

create index if not exists leaderboard_ranking
  on public.leaderboard (best_score desc, updated_at asc);

-- the name is only set the first time a player appears, so a leaked id cannot be
-- used to rename anyone, and the score only ever moves up.
create or replace function public.submit_score(
  player uuid,
  player_name text,
  new_score integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tidy_name text;
begin
  if new_score is null or new_score < 0 or new_score > 100000 then
    raise exception 'score out of range';
  end if;

  tidy_name := left(btrim(coalesce(player_name, '')), 16);
  if tidy_name = '' then
    tidy_name := 'anon';
  end if;

  insert into public.leaderboard (player_id, name, best_score)
  values (player, tidy_name, new_score)
  on conflict (player_id) do update
    set best_score = greatest(public.leaderboard.best_score, excluded.best_score),
        updated_at = now();
end;
$$;

-- player ids are deliberately not returned, an id is the only thing standing
-- between a stranger and writing to someone else's row.
create or replace function public.get_leaderboard(board_size integer default 10)
returns table (name text, best_score integer)
language sql
security definer
stable
set search_path = public
as $$
  select l.name, l.best_score
  from public.leaderboard l
  order by l.best_score desc, l.updated_at asc
  limit least(greatest(coalesce(board_size, 10), 1), 100);
$$;

revoke all on public.leaderboard from anon, authenticated;

grant execute on function public.submit_score(uuid, text, integer) to anon, authenticated;
grant execute on function public.get_leaderboard(integer) to anon, authenticated;
