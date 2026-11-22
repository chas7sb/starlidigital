import {useEffect} from 'react';
import {subscribe} from './api';
import type {Memory} from './api';
export function MemorySync({onChange}:{onChange:(memories:Memory[])=>void}){useEffect(()=>subscribe<{memoriesUpdated:Memory[]}>('subscription{memoriesUpdated{id title content projectId publicApproved createdAt}}',{},data=>onChange(data.memoriesUpdated)),[]);return null;}
