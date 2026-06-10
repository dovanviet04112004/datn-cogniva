/**
 * @cogniva/shared/query — query keys (và sau này query-option factories) dùng chung
 * web + mobile cho React Query.
 *
 * Lưu ý: KHÔNG export QueryClient/provider/persister ở đây — chúng platform-specific
 * (web: IndexedDB persister; mobile: AsyncStorage) nên ở từng app. Module này chỉ
 * chứa phần PORTABLE: keys + query definitions.
 */
export * from './keys';
